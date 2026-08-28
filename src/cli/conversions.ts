import 'dotenv/config';
import { Repository } from '../store/repository.js';
import { createMarianaTekClient } from '../marianaTek/index.js';

// Closes the loop on `npm run stats`'s "converted" column: that column has
// always existed (computeSegmentStats counts status === 'converted'), but
// nothing ever flipped a touch to 'converted' automatically — it required
// Lucas to notice a sale and run `npm run outcome -- <id> converted` by
// hand. This checks every contact we've actually sent something to against
// their LIVE Mariana Tek status and marks real conversions itself.
//
// "Converted" here means: we sent them something (they had no active
// status worth pitching around at the time — that's the whole premise of
// every segment in playbook.ts), and they now show a real active
// membership that started on or after our first outreach to them. A
// membership that predates our outreach isn't a conversion, it's a
// targeting mistake (and would mean the playbook pitched someone who
// didn't need it) — excluded rather than counted, and printed separately.

const repo = new Repository();
const mariana = createMarianaTekClient(process.env);

const touches = await repo.allTouches();

// One live check per contact, anchored on their EARLIEST touch that actually
// went out (sent or already converted) — that's when the clock on "did this
// work" starts. Later touches (e.g. a follow-up email) share the same
// contact and don't need a separate API call.
const firstOutreachByContact = new Map<string, (typeof touches)[number]>();
for (const t of touches) {
  if (t.status !== 'sent' && t.status !== 'converted') continue;
  const existing = firstOutreachByContact.get(t.contactId);
  if (!existing || t.proposedAt < existing.proposedAt) {
    firstOutreachByContact.set(t.contactId, t);
  }
}

if (firstOutreachByContact.size === 0) {
  console.log('No sent touches yet — nothing to check.');
  process.exit(0);
}

const newConversions: Array<{ name: string; segmentKey: string; planName: string; memberSince: string; daysToConvert: number }> = [];
const alreadyConverted: string[] = [];
const preExisting: Array<{ name: string; memberSince: string; touchDate: string }> = [];

for (const [contactId, firstTouch] of firstOutreachByContact) {
  const name = `${firstTouch.recipient.firstName} ${firstTouch.recipient.lastName}`;

  if (firstTouch.status === 'converted') {
    alreadyConverted.push(name);
    continue;
  }

  const status = await mariana.getMembershipStatus(contactId);
  if (status.kind !== 'membership_active') continue;

  const touchDate = firstTouch.outcomeAt ?? firstTouch.proposedAt;
  if (new Date(status.memberSince).getTime() < new Date(touchDate).getTime()) {
    // They were already an active member when we reached out — not a
    // conversion, flag separately since it usually means a targeting bug
    // (this segment should never have fired for them).
    preExisting.push({ name, memberSince: status.memberSince, touchDate });
    continue;
  }

  const daysToConvert = Math.round(
    (new Date(status.memberSince).getTime() - new Date(touchDate).getTime()) / (1000 * 60 * 60 * 24),
  );

  // Mark every 'sent' touch for this contact as converted, not just the
  // first — a follow-up email that also went out shouldn't keep getting
  // chased by check-replies.ts once they've already bought.
  const contactTouches = touches.filter((t) => t.contactId === contactId && t.status === 'sent');
  for (const t of contactTouches) {
    await repo.recordOutcome(
      t.id,
      'converted',
      `Membership active: ${status.planName}, started ${status.memberSince} (${daysToConvert}d after outreach)`,
    );
  }

  newConversions.push({ name, segmentKey: firstTouch.segmentKey, planName: status.planName, memberSince: status.memberSince, daysToConvert });
}

if (newConversions.length === 0) {
  console.log('No new conversions since the last check.');
} else {
  console.log(`--- ${newConversions.length} NEW CONVERSION${newConversions.length > 1 ? 'S' : ''} ---`);
  for (const c of newConversions) {
    console.log(`${c.name} — ${c.planName}, started ${c.memberSince} (${c.daysToConvert}d after we reached out, segment: ${c.segmentKey})`);
  }
}

if (alreadyConverted.length > 0) {
  console.log(`\nAlready recorded as converted (${alreadyConverted.length}): ${alreadyConverted.join(', ')}`);
}

if (preExisting.length > 0) {
  console.log(`\n--- FLAGGED: already had an active membership before we touched them (${preExisting.length}) ---`);
  for (const p of preExisting) {
    console.log(`${p.name} — member since ${p.memberSince}, but we touched them ${p.touchDate}. Worth checking why the playbook pitched them.`);
  }
}
