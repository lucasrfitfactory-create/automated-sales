import 'dotenv/config';
import { createHighLevelClient } from '../highlevel/index.js';
import { Repository } from '../store/repository.js';

// Sends ONE previously-proposed touch (`npm run assess` logs these) through
// HighLevel. Deliberately not part of `assess` — every send corresponds to
// an explicit approval from Lucas in chat; this script never runs on its
// own.

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

const [touchId] = process.argv.slice(2);
if (!touchId) {
  console.error('Usage: npm run send -- <touchId>');
  process.exit(1);
}

const repo = new Repository(STORE_PATH);
const touch = repo.allTouches().find((t) => t.id === touchId);
if (!touch) {
  console.error(`No touch log entry found for id: ${touchId}`);
  process.exit(1);
}
if (touch.status === 'sent') {
  console.error(`Touch ${touchId} was already sent (at ${touch.outcomeAt}) — refusing to send again.`);
  process.exit(1);
}

const highlevel = createHighLevelClient(process.env);

const contact = await highlevel.upsertContact({
  firstName: touch.recipient.firstName,
  lastName: touch.recipient.lastName,
  email: touch.recipient.email,
  phone: touch.recipient.phone,
});

if (touch.channel === 'email') {
  if (!contact.email) throw new Error(`Contact ${contact.id} has no email on file — can't send email touch ${touchId}.`);
  await highlevel.sendEmail(contact.id, { subject: touch.headline, body: touch.message });
} else {
  if (!contact.phone) throw new Error(`Contact ${contact.id} has no phone on file — can't send text touch ${touchId}.`);
  await highlevel.sendSms(contact.id, { body: touch.message });
}

repo.recordOutcome(touchId, 'sent');
repo.save();
console.log(`Sent ${touch.channel} to ${touch.recipient.firstName} ${touch.recipient.lastName} (HighLevel contact ${contact.id}${contact.isNew ? ', newly created' : ''}).`);
