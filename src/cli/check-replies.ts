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

const repo = new Repository();
const highlevel = createHighLevelClient(process.env);

const sentTouches = (await repo.allTouches()).filter((t) => t.status === 'sent' && t.outcomeAt);

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
    // A reply existing isn't the same as it still needing attention — check
    // whether a later outbound (Lucas personally, or anyone) already
    // answered the most recent inbound message before flagging this as
    // pending. Confirmed 2026-08-27, Ramona Bissoon: her reply was reported
    // as needing action when Lucas had already replied with full pricing
    // hours earlier — this check is what that was missing.
    const mostRecentReply = newReplies[0]; // history is most-recent-first
    const laterOutbound = history.find(
      (m) => m.direction === 'outbound' && (m.dateAdded ?? '') > (mostRecentReply?.dateAdded ?? ''),
    );

    console.log(laterOutbound ? '--- REPLY (already answered) ---' : '--- NEW REPLY (needs a look) ---');
    console.log(`Touch: ${touch.id}`);
    console.log(`Client: ${touch.recipient.firstName} ${touch.recipient.lastName}`);
    console.log(`Segment: ${touch.segmentKey}`);
    console.log(`Sent: ${touch.outcomeAt}`);
    console.log(`Original message: "${touch.message}"`);
    console.log(`Reply/replies since sent:`);
    for (const m of newReplies.slice().reverse()) {
      console.log(`  [${m.dateAdded}] ${m.type}: ${m.body ?? '(no body)'}`);
    }
    if (laterOutbound) {
      console.log(`Already handled: [${laterOutbound.dateAdded}] ${laterOutbound.body ?? '(no body)'}`);
    }
    continue; // they've engaged — a reply takes priority over an automated follow-up
  }

  if (!touch.followUp || touch.followUp.proposedTouchId) continue;
  // floor, not round — per Lucas 2026-08-27, a follow-up must wait the FULL
  // afterDays, not just "close enough" (rounding let a 16-hour gap read as
  // "1 day" and fire a same-day follow-up).
  const daysSinceSent = Math.floor((Date.now() - new Date(touch.outcomeAt!).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSinceSent < touch.followUp.afterDays) continue;

  anythingFound = true;
  const followUpTouchId = `followup:${touch.id}`;
  await repo.recordTouch({
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
  await repo.markFollowUpProposed(touch.id, followUpTouchId);

  console.log('--- FOLLOW-UP DUE (no reply after text) ---');
  console.log(`Original touch: ${touch.id} (sent ${daysSinceSent}d ago, no reply)`);
  console.log(`Client: ${touch.recipient.firstName} ${touch.recipient.lastName}`);
  console.log(`Follow-up queued: ${followUpTouchId}`);
  console.log(`Channel: ${touch.followUp.channel.toUpperCase()}`);
  console.log(`Message: "${touch.followUp.message}"`);
}

if (!anythingFound) {
  console.log('Nothing to report — no new replies, no follow-ups due yet.');
}
