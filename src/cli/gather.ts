import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createMarianaTekClient } from '../marianaTek/index.js';
import type { MtMembershipStatus } from '../marianaTek/types.js';
import { createHighLevelClient } from '../highlevel/index.js';
import { evaluate } from '../rules/engine.js';
import { PLAYBOOK } from '../rules/playbook.js';
import { Repository } from '../store/repository.js';

// Step 1 of 2 in the chat-driven pipeline (replaces the old assess.ts,
// which both matched a rule AND recorded a fixed template as the touch).
// This step only GATHERS: it pulls every class between the last processed
// class and right now, matches each attendee against the playbook to find
// which segment/product applies (still the source of truth for cooldowns,
// compliance, and pricing), and writes a candidate manifest to
// data/gather/<ts>.json. It does NOT write anything to the touch log.
//
// The actual message text gets written by whoever is running this — Claude,
// live in chat, reading each candidate's real account/attendance context
// and drafting something genuinely personalized, using the playbook's
// `referenceMessage` as the compliant baseline (single product, correct
// price, direct close, no em-dash) rather than sending it verbatim. Once
// drafted, `npm run propose -- <file>` records the finished touches.
//
// IMPORTANT (bug caught 2026-08-26, Estef Campuzano): the segment label
// alone doesn't tell you WHERE in a trial someone is — "mid-trial" spans
// day 2 through day ~27 of a ~30-day trial. Always check the raw `status`
// field's actual dates (e.g. trial `endDate`) before implying urgency
// ("keep this going") — someone 3 days into a trial with 4 weeks left
// should get a no-pressure interest check, not language that reads like
// their access is about to run out.
//
// IMPORTANT (bug caught 2026-08-27, Bahi Hamraz & Lorena Garcia): cooldown
// used to only check this pipeline's OWN touch log — blind to (a) a real,
// active conversation happening in HighLevel (Bahi was mid-negotiation
// over commitment length with Lucas when an automated "would you be open
// to hearing about options?" text landed on top of it), and (b) Fit
// Factory's separate, independent automated texting system pitching the
// same person the day before with zero coordination (Lorena got hit by
// that system's generic template, then by this pipeline the very next
// morning). Every candidate now gets checked against their REAL HighLevel
// conversation history, not just this pipeline's own record — see
// `checkHighLevelActivity` below. If a segment ever needs re-litigating,
// this is why: the dedup boundary is "has ANYONE contacted or heard from
// this person recently," not "have I."
//
// CURSOR: "since" defaults to wherever the pipeline left off last time
// (the "gather_since" cursor in data/store.json) rather than a fixed rolling
// window — so every run picks up exactly the classes that happened since
// the last run, no matter how long the gap. First-ever run (no cursor yet)
// falls back to GATHER_INITIAL_LOOKBACK_HOURS (default 24h). ASSESS_SINCE/
// ASSESS_BEFORE still override both, for targeting an explicit range.

const CURSOR_KEY = 'gather_since';
const INITIAL_LOOKBACK_HOURS = Number(process.env.GATHER_INITIAL_LOOKBACK_HOURS ?? 24);
const EXPLICIT_SINCE = process.env.ASSESS_SINCE;
const EXPLICIT_BEFORE = process.env.ASSESS_BEFORE;

interface GatherCandidate {
  type: 'candidate';
  classSessionId: string;
  className: string;
  classStartTime: string;
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  attendanceLast30Days: number;
  /** Raw status Mariana Tek returned (trial start/end dates, pack counts, etc.) — always included, not just for segments whose copy already surfaces it, so tone can be checked against real dates (e.g. don't imply urgency for someone weeks into a trial) instead of assumed from the segment label alone. */
  status: MtMembershipStatus;
  segmentKey: string;
  segmentLabel: string;
  channel: 'email' | 'text';
  cooldownDays: number;
  referenceHeadline: string;
  referenceMessage: string;
  referenceFollowUp?: { channel: 'email'; headline: string; message: string; afterDays: number };
  priorRejections?: { note: string; at: string }[];
}

interface GatherSkipped {
  type: 'skipped_cooldown';
  classSessionId: string;
  className: string;
  contactId: string;
  firstName: string;
  lastName: string;
  segmentLabel: string;
  daysSinceLastTouch: number;
  cooldownDays: number;
  /** 'pipeline' = our own touch log; 'external' = someone/something else already messaged them recently (the other automated system, staff, etc.). */
  source: 'pipeline' | 'external';
}

/** Real back-and-forth in HighLevel recently — a human is already in this conversation. Never auto-drafted; surfaced so Lucas can decide. */
interface GatherActiveConversation {
  type: 'active_conversation';
  classSessionId: string;
  className: string;
  contactId: string;
  firstName: string;
  lastName: string;
  lastInboundAt: string;
  lastInboundBody: string | null;
  lastOutboundAt: string | null;
  lastOutboundBody: string | null;
}

interface GatherNoAction {
  type: 'no_action';
  classSessionId: string;
  className: string;
  contactId: string;
  firstName: string;
  lastName: string;
  statusSummary: string;
}

type GatherItem = GatherCandidate | GatherSkipped | GatherActiveConversation | GatherNoAction;

function daysSince(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  return Math.round((now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function describeStatus(status: MtMembershipStatus): string {
  switch (status.kind) {
    case 'trial_offer':
      return `${status.offerName} (no rule matched)`;
    case 'class_pack':
      return `${status.packName} — ${status.classesRemaining}/${status.classesTotal} left${status.expiresAt ? `, exp ${status.expiresAt.slice(0, 10)}` : ''}`;
    case 'membership_active':
      return `active member (${status.planName})`;
    case 'membership_paused':
      return `paused member (${status.planName}${status.resumesAt ? `, resumes ${status.resumesAt.slice(0, 10)}` : ''})`;
    case 'membership_lapsed':
      return `${status.planName} (no rule matched)`;
    case 'no_active_status':
      return 'no active offer/membership/pack on file';
  }
}

async function main() {
  const locationId = process.env.MARIANA_TEK_LOCATION_ID;
  if (!locationId) throw new Error('MARIANA_TEK_LOCATION_ID is not set (see .env.example).');

  const mariana = createMarianaTekClient(process.env);
  const highlevel = createHighLevelClient(process.env);
  const repo = new Repository();

  const now = new Date();
  let since: Date;
  let before: Date;
  if (EXPLICIT_SINCE && EXPLICIT_BEFORE) {
    since = new Date(EXPLICIT_SINCE);
    before = new Date(EXPLICIT_BEFORE);
  } else {
    const cursor = await repo.getCursor(CURSOR_KEY);
    since = cursor ? new Date(cursor) : new Date(now.getTime() - INITIAL_LOOKBACK_HOURS * 60 * 60 * 1000);
    before = now;
  }

  console.error(
    `Gathering classes from ${since.toISOString()} to ${before.toISOString()}${!EXPLICIT_SINCE ? ' (cursor-driven)' : ' (explicit range)'}.`,
  );

  const sessions = await mariana.getClassSessions({
    locationId,
    since: since.toISOString(),
    before: before.toISOString(),
  });

  const processedFlags = await Promise.all(sessions.map((s) => repo.isClassProcessed(s.id)));
  const unprocessed = sessions.filter((_, i) => !processedFlags[i]);

  // GOLDEN RULE, per Lucas 2026-08-28: never contact someone who's already
  // converted — a committed membership, active OR pending. getMembershipStatus
  // is the primary source of truth (fixed the same day to catch
  // pending_customer_activation/pending_start_date, not just 'active' — see
  // realClient.ts), but this is a second, independent check against our own
  // touch log so a stale/lagging Mariana Tek read can never re-pitch someone
  // we've already recorded as converted (e.g. a personally-closed deal like
  // Nicolas Nkiere's, recorded manually with no live-status dependency at all).
  const convertedAt = new Map(
    (await repo.allTouches()).filter((t) => t.status === 'converted').map((t) => [t.contactId, t.outcomeAt ?? t.proposedAt]),
  );

  const items: GatherItem[] = [];

  for (const session of unprocessed) {
    const roster = await mariana.getRoster(session.id);
    for (const entry of roster) {
      if (!entry.attended) continue;
      const attendanceSince = new Date(now);
      attendanceSince.setDate(attendanceSince.getDate() - 30);
      const [client, status, attendanceLast30Days] = await Promise.all([
        mariana.getClient(entry.clientId),
        mariana.getMembershipStatus(entry.clientId),
        mariana.getRecentAttendanceCount(entry.clientId, attendanceSince.toISOString()),
      ]);

      if (convertedAt.has(client.id)) {
        items.push({
          type: 'no_action',
          classSessionId: session.id,
          className: session.className,
          contactId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          statusSummary: `already converted (recorded ${convertedAt.get(client.id)}) — never re-pitched`,
        });
        continue;
      }

      const action = evaluate({ client, status, classSession: session, rosterEntry: entry, now, attendanceLast30Days }, PLAYBOOK);

      if (!action) {
        items.push({
          type: 'no_action',
          classSessionId: session.id,
          className: session.className,
          contactId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          statusSummary: describeStatus(status),
        });
        continue;
      }

      // Real HighLevel history, not just our own touch log — catches both
      // an active human conversation (don't add an automated pitch on top
      // of it) and a recent message from ANY source (the other automated
      // system, staff, etc.) that should still count against the cooldown.
      const hlContact = await highlevel.upsertContact({
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
      });
      const history = await highlevel.getConversationHistory(hlContact.id);
      const lastInbound = history.find((m) => m.direction === 'inbound') ?? null;
      const lastOutbound = history.find((m) => m.direction === 'outbound') ?? null;
      const daysSinceInbound = daysSince(lastInbound?.dateAdded, now);
      const daysSinceOutbound = daysSince(lastOutbound?.dateAdded, now);

      // A real reply in the last 3 days means someone's actively talking
      // to this person right now — never auto-draft on top of that.
      if (daysSinceInbound !== null && daysSinceInbound <= 3) {
        items.push({
          type: 'active_conversation',
          classSessionId: session.id,
          className: session.className,
          contactId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          lastInboundAt: lastInbound!.dateAdded!,
          lastInboundBody: lastInbound!.body,
          lastOutboundAt: lastOutbound?.dateAdded ?? null,
          lastOutboundBody: lastOutbound?.body ?? null,
        });
        continue;
      }

      const lastTouch = await repo.getLastTouch(client.id, action.segmentKey);
      const daysSinceInternal = daysSince(lastTouch?.proposedAt, now);
      // Whichever is more recent wins — our own record or an external one.
      const cooldownCandidates = [
        daysSinceInternal !== null ? { days: daysSinceInternal, source: 'pipeline' as const } : null,
        daysSinceOutbound !== null ? { days: daysSinceOutbound, source: 'external' as const } : null,
      ].filter((c): c is { days: number; source: 'pipeline' | 'external' } => c !== null);
      const mostRecent = cooldownCandidates.sort((a, b) => a.days - b.days)[0];

      if (mostRecent && mostRecent.days < action.cooldownDays) {
        items.push({
          type: 'skipped_cooldown',
          classSessionId: session.id,
          className: session.className,
          contactId: client.id,
          firstName: client.firstName,
          lastName: client.lastName,
          segmentLabel: action.segmentLabel,
          daysSinceLastTouch: mostRecent.days,
          cooldownDays: action.cooldownDays,
          source: mostRecent.source,
        });
        continue;
      }

      const priorRejections = await repo.getRejectedTouches(client.id);

      items.push({
        type: 'candidate',
        classSessionId: session.id,
        className: session.className,
        classStartTime: session.startTime,
        contactId: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        email: client.email,
        phone: client.phone,
        attendanceLast30Days,
        status,
        segmentKey: action.segmentKey,
        segmentLabel: action.segmentLabel,
        channel: action.channel,
        cooldownDays: action.cooldownDays,
        referenceHeadline: action.headline,
        referenceMessage: action.message,
        referenceFollowUp: action.followUp,
        priorRejections: priorRejections.length
          ? priorRejections.map((r) => ({ note: r.outcomeNote ?? '', at: r.outcomeAt ?? r.proposedAt }))
          : undefined,
      });
    }
    await repo.markClassProcessed(session.id);
  }

  if (!EXPLICIT_SINCE) {
    await repo.setCursor(CURSOR_KEY, before.toISOString());
  }

  mkdirSync('data/gather', { recursive: true });
  const outPath = `data/gather/${now.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  const counts = {
    classes: unprocessed.length,
    candidates: items.filter((i) => i.type === 'candidate').length,
    skippedCooldown: items.filter((i) => i.type === 'skipped_cooldown').length,
    activeConversation: items.filter((i) => i.type === 'active_conversation').length,
    noAction: items.filter((i) => i.type === 'no_action').length,
    flaggedPriorRejection: items.filter((i) => i.type === 'candidate' && i.priorRejections?.length).length,
  };

  console.log(JSON.stringify({ outPath, since: since.toISOString(), before: before.toISOString(), counts }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
