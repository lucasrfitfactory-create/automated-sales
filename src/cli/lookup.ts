import 'dotenv/config';
import { createHighLevelClient } from '../highlevel/index.js';

// Ad-hoc: find a HighLevel contact by phone/email and print their message
// history. Useful on its own (e.g. sanity-checking a real send target) and
// is the same read path the learning loop will eventually use to check for
// replies before re-touching someone.

const [phoneOrEmail, firstName, lastName] = process.argv.slice(2);
if (!phoneOrEmail) {
  console.error('Usage: npm run lookup -- <phone-or-email> [firstName] [lastName]');
  process.exit(1);
}

const isEmail = phoneOrEmail.includes('@');
const highlevel = createHighLevelClient(process.env);

const contact = await highlevel.upsertContact({
  firstName: firstName ?? '',
  lastName: lastName ?? '',
  email: isEmail ? phoneOrEmail : null,
  phone: isEmail ? null : phoneOrEmail,
});

console.log(`Contact: ${contact.firstName} ${contact.lastName} (id ${contact.id}) — ${contact.isNew ? 'newly created' : 'existing contact'}`);
console.log(`  email: ${contact.email ?? '—'}, phone: ${contact.phone ?? '—'}`);

const history = await highlevel.getConversationHistory(contact.id);
if (history.length === 0) {
  console.log('No conversation history.');
} else {
  console.log(`\n${history.length} message(s), most recent first:`);
  for (const m of history) {
    console.log(`  [${m.dateAdded ?? '?'}] ${m.direction} ${m.type}: ${m.body ?? '(no body)'}`);
  }
}
