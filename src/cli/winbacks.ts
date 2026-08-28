import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createMarianaTekClient } from '../marianaTek/index.js';
import { createHighLevelClient } from '../highlevel/index.js';
import { Repository } from '../store/repository.js';

// Companion to gather.ts, run alongside it every job (per Lucas, 2026-08-28):
// gather.ts only ever looks at attendees of NEWLY completed classes since the
// last cursor — it has no way to notice someone whose trial quietly expired
// weeks ago without ever converting or getting a real follow-up. This scans
// for exactly that: expired trials (1-week, 1-month, ClassPass, Comeback)
// within a lookback window that never converted, applying the SAME
// double-text protections as gather.ts (real HighLevel history, not just our
// own log; a recent reply blocks auto-drafting; per-contact cooldown on this
// segment).
//
// "Converted" is checked two ways, not just one — a real bug found
// 2026-08-28 (Dionne Hsu, Jacqueline Wei): someone can convert to a class
// PACK instead of a membership, and an earlier version of this analysis only
// checked for a later real membership_instance, silently missing pack
// conversions. Both are checked here.
//
// Segment key is always 'expired_trial_winback' — cooldown against it is
// what stops the same expired trial from being re-surfaced every run once
// it's been handled (or explicitly held).

const LOOKBACK_DAYS = Number(process.env.WINBACK_LOOKBACK_DAYS ?? 30);
const SEGMENT_KEY = 'expired_trial_winback';
const COOLDOWN_DAYS = 30; // don't re-surface the same expired trial more than once a month
const CACHE_PATH = 'data/analysis/membership_instances_downtown.json';
const CACHE_MAX_AGE_HOURS = 12;

const OFFER_TYPES = [
  { key: '1-Week', pattern: /1[\s-]*week/i },
  { key: '1-Month New Client', pattern: /new client offer.*1 month/i },
  { key: '1-Month ClassPass Client', pattern: /class pass client offer.*1 month/i },
  { key: 'Comeback Offer', pattern: /comeback offer/i },
];

const isOtherBusinessProduct = (name: string) => /refined|reformer|\bpsc\b/i.test(name ?? '');
const isRealStatus = (status: string) => status === 'active' || status === 'pending_customer_activation' || status === 'pending_start_date';

interface WinbackCandidate {
  type: 'candidate';
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  offerType: string;
  offerName: string;
  trialStart: string;
  trialEnd: string;
  classesDuringTrial: number;
  classesAfterTrial: number;
  lastVisit: string | null;
  everContactedBefore: boolean;
  lastOutboundAt: string | null;
  lastOutboundBody: string | null;
  lastInboundAt: string | null;
  lastInboundBody: string | null;
  segmentKey: 'expired_trial_winback';
}

interface WinbackSkipped {
  type: 'skipped_cooldown' | 'active_conversation' | 'no_action';
  contactId: string;
  firstName: string;
  lastName: string;
  reason: string;
}

async function main() {
  const apiUrl = process.env.MARIANA_TEK_API_URL!;
  const apiKey = process.env.MARIANA_TEK_API_KEY!;
  const downtownLocationId = process.env.MARIANA_TEK_LOCATION_ID!;
  if (!apiUrl || !apiKey || !downtownLocationId) {
    throw new Error('MARIANA_TEK_API_URL, MARIANA_TEK_API_KEY, MARIANA_TEK_LOCATION_ID must be set (real mode only — winbacks.ts does not support mock mode).');
  }

  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, apiUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/vnd.api+json' } });
    if (!res.ok) throw new Error(`Mariana Tek API GET ${path} failed: ${res.status} ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // Reuse the cached bulk pull if fresh — this endpoint has no working
  // server-side filter (confirmed 2026-08-27/28: location/name/intro-offer
  // params are all silently ignored), so every fresh pull costs ~40+
  // requests regardless. No need to pay that cost more than a couple times
  // a day.
  let downtown: any[];
  const cacheFresh = existsSync(CACHE_PATH) && (Date.now() - statSync(CACHE_PATH).mtimeMs) / (1000 * 60 * 60) < CACHE_MAX_AGE_HOURS;
  if (cacheFresh) {
    console.error(`Reusing cached membership_instances pull (< ${CACHE_MAX_AGE_HOURS}h old).`);
    downtown = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } else {
    console.error('Cache stale or missing — pulling all membership_instances (location has no working filter, this walks every page)...');
    const all: any[] = [];
    let page = 1;
    while (true) {
      const d: any = await get('/api/membership_instances/', { page_size: '100', page: String(page) });
      all.push(...d.data);
      const pages = d.meta?.pagination?.pages ?? 1;
      if (page >= pages) break;
      page++;
    }
    downtown = all.filter((i) => i.relationships?.purchase_location?.data?.id === downtownLocationId);
    mkdirSync('data/analysis', { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(downtown));
    console.error(`Pulled and cached ${downtown.length} Downtown membership_instances.`);
  }

  const byUser = new Map<string, any[]>();
  for (const inst of downtown) {
    const uid = inst.relationships?.user?.data?.id;
    if (!uid) continue;
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid)!.push(inst);
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  const expiredUnconverted: Array<{ userId: string; offerType: string; offerName: string; startDate: string; endDate: string }> = [];

  for (const inst of downtown) {
    const a = inst.attributes;
    if (!a.is_intro_offer || isOtherBusinessProduct(a.membership_name)) continue;
    const offerType = OFFER_TYPES.find((o) => o.pattern.test(a.membership_name ?? ''));
    if (!offerType) continue;

    const endDate = a.end_date ?? a.scheduled_end_datetime ?? a.calculated_end_datetime ?? a.payment_interval_end_date ?? a.start_date;
    if (!endDate) continue; // pending_customer_activation, never started
    const endDateObj = new Date(endDate);
    if (endDateObj > now || endDateObj < cutoff) continue; // still running, or too old to be actionable

    const userId = inst.relationships?.user?.data?.id;
    const userInstances = byUser.get(userId) ?? [];
    const trialPurchase = a.purchase_date;

    const convertedToMembership = userInstances.some(
      (i) =>
        i.id !== inst.id &&
        !i.attributes.is_intro_offer &&
        !isOtherBusinessProduct(i.attributes.membership_name) &&
        isRealStatus(i.attributes.status) &&
        i.attributes.purchase_date &&
        trialPurchase &&
        i.attributes.purchase_date > trialPurchase,
    );
    if (convertedToMembership) continue;

    expiredUnconverted.push({ userId, offerType: offerType.key, offerName: a.membership_name, startDate: a.start_date, endDate });
  }

  console.error(`Found ${expiredUnconverted.length} expired, membership-unconverted trials in the last ${LOOKBACK_DAYS}d.`);

  const mariana = createMarianaTekClient(process.env);
  const highlevel = createHighLevelClient(process.env);
  const repo = new Repository();

  const items: (WinbackCandidate | WinbackSkipped)[] = [];

  for (const t of expiredUnconverted) {
    const client = await mariana.getClient(t.userId);

    // Second conversion check: a real class pack purchased any time during
    // or after the trial. Not location-scoped (credit_transactions has no
    // location field) — a Midtown/other-location grant, or a one-off event
    // product (HYROX race entry, etc.), is filtered out since neither
    // represents a real Downtown pack conversion.
    const creditData: any = await get('/api/credit_transactions/', { user: t.userId, page_size: '100' });
    const boughtPack = (creditData.data ?? []).some(
      (c: any) =>
        c.attributes.remaining_credits_cache !== null &&
        c.attributes.transaction_datetime > t.startDate &&
        !/midtown|complimentary|hyrox|race entry/i.test(c.attributes.credit_name ?? ''),
    );
    if (boughtPack) {
      items.push({ type: 'no_action', contactId: t.userId, firstName: client.firstName, lastName: client.lastName, reason: 'already converted to a class pack' });
      continue;
    }

    // Cross-check our own log first (cheap) — skip if we've surfaced this
    // exact segment for them within the cooldown, regardless of outcome
    // (proposed/sent/rejected all count — no point re-drafting something
    // Lucas already decided on recently).
    const lastTouch = await repo.getLastTouch(t.userId, SEGMENT_KEY);
    if (lastTouch) {
      const daysSince = Math.floor((now.getTime() - new Date(lastTouch.proposedAt).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince < COOLDOWN_DAYS) {
        items.push({ type: 'skipped_cooldown', contactId: t.userId, firstName: client.firstName, lastName: client.lastName, reason: `already surfaced ${daysSince}d ago` });
        continue;
      }
    }

    // Real HighLevel history — same rule as gather.ts: a reply in the last
    // 3 days means a human is already talking to them, never auto-draft on
    // top of it. Any outbound within the cooldown (from ANY source, not
    // just us) also blocks it.
    const hl = await highlevel.upsertContact({ firstName: client.firstName, lastName: client.lastName, email: client.email, phone: client.phone });
    const history = await highlevel.getConversationHistory(hl.id);
    const lastInbound = history.find((m) => m.direction === 'inbound') ?? null;
    const lastOutbound = history.find((m) => m.direction === 'outbound') ?? null;
    const daysSinceInbound = lastInbound?.dateAdded ? Math.floor((now.getTime() - new Date(lastInbound.dateAdded).getTime()) / (1000 * 60 * 60 * 24)) : null;
    const daysSinceOutbound = lastOutbound?.dateAdded ? Math.floor((now.getTime() - new Date(lastOutbound.dateAdded).getTime()) / (1000 * 60 * 60 * 24)) : null;

    if (daysSinceInbound !== null && daysSinceInbound <= 3) {
      items.push({ type: 'active_conversation', contactId: t.userId, firstName: client.firstName, lastName: client.lastName, reason: `real reply ${daysSinceInbound}d ago — being handled directly` });
      continue;
    }
    if (daysSinceOutbound !== null && daysSinceOutbound < COOLDOWN_DAYS) {
      items.push({ type: 'skipped_cooldown', contactId: t.userId, firstName: client.firstName, lastName: client.lastName, reason: `outside contact ${daysSinceOutbound}d ago` });
      continue;
    }

    // Attendance during and after the trial — the single most useful
    // signal for how to pitch this (someone who kept showing up unpaid
    // after expiry is a very different message than someone who took 1
    // class and vanished).
    const resv: any = await get('/api/reservations/', { user: t.userId, page_size: '100' });
    const checkedIn = (resv.data ?? []).filter((r: any) => r.attributes.status === 'check in');
    const duringTrial = checkedIn.filter((r: any) => r.attributes.check_in_date >= t.startDate && r.attributes.check_in_date <= t.endDate).length;
    const afterTrial = checkedIn.filter((r: any) => r.attributes.check_in_date > t.endDate).length;
    const lastVisit = checkedIn.sort((a: any, b: any) => (b.attributes.check_in_date ?? '').localeCompare(a.attributes.check_in_date ?? ''))[0]?.attributes.check_in_date ?? null;

    items.push({
      type: 'candidate',
      contactId: t.userId,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      offerType: t.offerType,
      offerName: t.offerName,
      trialStart: t.startDate,
      trialEnd: t.endDate,
      classesDuringTrial: duringTrial,
      classesAfterTrial: afterTrial,
      lastVisit,
      everContactedBefore: history.length > 0,
      lastOutboundAt: lastOutbound?.dateAdded ?? null,
      lastOutboundBody: lastOutbound?.body ?? null,
      lastInboundAt: lastInbound?.dateAdded ?? null,
      lastInboundBody: lastInbound?.body ?? null,
      segmentKey: SEGMENT_KEY,
    });
  }

  mkdirSync('data/gather', { recursive: true });
  const outPath = `data/gather/winbacks-${now.toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  const counts = {
    candidates: items.filter((i) => i.type === 'candidate').length,
    alreadyConvertedToPack: items.filter((i) => i.type === 'no_action').length,
    activeConversation: items.filter((i) => i.type === 'active_conversation').length,
    skippedCooldown: items.filter((i) => i.type === 'skipped_cooldown').length,
  };
  console.log(JSON.stringify({ outPath, lookbackDays: LOOKBACK_DAYS, counts }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
