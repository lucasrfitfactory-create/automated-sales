import 'dotenv/config';
import { createHighLevelClient } from '../highlevel/index.js';
import { Repository } from '../store/repository.js';
import type { TouchLogEntry } from '../store/types.js';

// Sends one or more previously-proposed touches (`npm run assess` logs
// these) through HighLevel. Deliberately not part of `assess` — every send
// corresponds to an explicit approval from Lucas, either in chat or via the
// send.yml GitHub Actions workflow_dispatch input; this script never runs
// on its own.
//
// Usage:
//   npm run send -- <touchId> [touchId ...]   send specific touches
//   npm run send -- all                       send every touch currently
//                                              status: 'proposed'

const args = process.argv.slice(2).flatMap((a) => a.split(/[\s,]+/)).filter(Boolean);
if (args.length === 0) {
  console.error('Usage: npm run send -- <touchId> [touchId ...] | all');
  process.exit(1);
}

const repo = new Repository();
const highlevel = createHighLevelClient(process.env);

const touches: TouchLogEntry[] = [];
if (args.length === 1 && args[0] === 'all') {
  touches.push(...(await repo.allTouches()).filter((t) => t.status === 'proposed'));
  if (touches.length === 0) {
    console.log('No touches with status "proposed" — nothing to send.');
    process.exit(0);
  }
} else {
  for (const touchId of args) {
    const touch = await repo.getTouch(touchId);
    if (!touch) {
      console.error(`No touch log entry found for id: ${touchId} — skipping.`);
      continue;
    }
    if (touch.status === 'sent') {
      console.error(`Touch ${touchId} was already sent (at ${touch.outcomeAt}) — skipping.`);
      continue;
    }
    touches.push(touch);
  }
}

let failures = 0;

for (const touch of touches) {
  try {
    const contact = await highlevel.upsertContact({
      firstName: touch.recipient.firstName,
      lastName: touch.recipient.lastName,
      email: touch.recipient.email,
      phone: touch.recipient.phone,
    });

    if (touch.channel === 'email') {
      if (!contact.email) throw new Error(`Contact ${contact.id} has no email on file — can't send email touch ${touch.id}.`);
      await highlevel.sendEmail(contact.id, { subject: touch.headline, body: touch.message });
    } else {
      if (!contact.phone) throw new Error(`Contact ${contact.id} has no phone on file — can't send text touch ${touch.id}.`);
      await highlevel.sendSms(contact.id, { body: touch.message });
    }

    await repo.recordOutcome(touch.id, 'sent');
    console.log(
      `Sent ${touch.channel} to ${touch.recipient.firstName} ${touch.recipient.lastName} (HighLevel contact ${contact.id}${contact.isNew ? ', newly created' : ''}) — touch ${touch.id}.`,
    );
  } catch (err) {
    failures++;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAILED to send touch ${touch.id} (${touch.recipient.firstName} ${touch.recipient.lastName}): ${message}`);
    await repo.recordOutcome(touch.id, 'rejected', `send failed: ${message}`);
  }
}

console.log(`\nDone: ${touches.length - failures}/${touches.length} sent.`);
if (failures > 0) process.exit(1);
