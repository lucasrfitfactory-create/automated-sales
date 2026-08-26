import 'dotenv/config';
import { createHighLevelClient } from '../highlevel/index.js';
import { Repository } from '../store/repository.js';

// Reviews every touch we've actually sent, two ways:
//   1. New replies since it was sent — surfaced as raw text. Doesn't try to
//      auto-classify "yes" vs "no" vs "a question" — freeform replies are
//      too varied for a keyword match to be trusted with something as
//      consequential as a sale. Claude reads them and flags anything that
//      looks like agreement as IMPORTANT when reporting to Lucas — he
//      processes the actual sale manually in Mariana Tek (confirmed
//      2026-08-26: no purchase-creation API exists, and browser automation
//      into the POS is blocked at the platform level either way).
//   2. Due follow-ups — a touch was a text, got no reply, and
//      `followUp.afterDays` has passed. That follow-up (always email) gets
//      queued as a brand-new 'proposed' touch, same as anything from
//      `npm run assess` — Lucas approves it the same way before it sends.
//      Never queued twice for the same original touch.
//
// Not scheduled/continuous yet — run this on demand until a cron-style
// check is wired up. This is "the job" reviewing what it already sent, per
// Lucas 2026-08-26: run it every time, not just when checking for replies.

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

const repo = new Repository(STORE_PATH);
const highlevel = createHighLevelClient(process.env);

const sentTouches = repo.allTouches().filter((t) => t.status === 'sent' && t.outcomeAt);

if (sentTouches.length === 0) {
  console.log('No sent touches yet — nothing to review.');
  process.exit(0);
}

let anythingFound = false;

for (const touch of sentTouches) {
  const contact = await highlevel.upsertContact({
    firstName: touch.recipient.firstName,
    lastName: touch.recipient.lastName,
    email: touch.recipient.email,
    phone: touch.recipient.phone,
  });
  const history = await highlevel.getConversationHistory(contact.id);
  const newReplies = history.filter((m) => m.direction === 'inbound' && (m.dateAdded ?? '') > touch.outcomeAt!);

  if (newReplies.length > 0) {
    anythingFound = true;
    console.log('--- NEW REPLY ---');
    console.log(`Touch: ${touch.id}`);
    console.log(`Client: ${touch.recipient.firstName} ${touch.recipient.lastName}`);
    console.log(`Segment: ${touch.segmentKey}`);
    console.log(`Sent: ${touch.outcomeAt}`);
    console.log(`Original message: "${touch.message}"`);
    console.log(`New reply/replies since sent:`);
    for (const m of newReplies.reverse()) {
      console.log(`  [${m.dateAdded}] ${m.type}: ${m.body ?? '(no body)'}`);
    }
    continue; // they've engaged — a reply takes priority over an automated follow-up
  }

  if (!touch.followUp || touch.followUp.proposedTouchId) continue;
  const daysSinceSent = Math.round((Date.now() - new Date(touch.outcomeAt!).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceSent < touch.followUp.afterDays) continue;

  anythingFound = true;
  const followUpTouchId = `followup:${touch.id}`;
  repo.recordTouch({
    id: followUpTouchId,
    contactId: touch.contactId,
    segmentKey: `${touch.segmentKey}_followup`,
    channel: touch.followUp.channel,
    classSessionId: touch.classSessionId,
    proposedAt: new Date().toISOString(),
    status: 'proposed',
    recipient: touch.recipient,
    headline: touch.followUp.headline,
    message: touch.followUp.message,
  });
  repo.markFollowUpProposed(touch.id, followUpTouchId);

  console.log('--- FOLLOW-UP DUE (no reply after text) ---');
  console.log(`Original touch: ${touch.id} (sent ${daysSinceSent}d ago, no reply)`);
  console.log(`Client: ${touch.recipient.firstName} ${touch.recipient.lastName}`);
  console.log(`Follow-up queued: ${followUpTouchId}`);
  console.log(`Channel: ${touch.followUp.channel.toUpperCase()}`);
  console.log(`Message: "${touch.followUp.message}"`);
}

repo.save();

if (!anythingFound) {
  console.log('Nothing to report — no new replies, no follow-ups due yet.');
}
