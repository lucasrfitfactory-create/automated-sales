import 'dotenv/config';
import { createHighLevelClient } from '../highlevel/index.js';
import { Repository } from '../store/repository.js';

// Checks every touch we've actually sent for client replies since. Doesn't
// try to auto-classify "yes" vs "no" vs "a question" — freeform replies are
// too varied for a keyword match to be trusted with something as
// consequential as a sale. Instead this surfaces the raw reply so I (Claude)
// read it and flag anything that looks like agreement as IMPORTANT when
// reporting to Lucas — he processes the actual sale manually in Mariana Tek
// (confirmed 2026-08-26: no purchase-creation API exists, and browser
// automation into the POS is blocked at the platform level either way).
//
// Not scheduled/continuous yet — run this on demand until a cron-style
// check is wired up.

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

const repo = new Repository(STORE_PATH);
const highlevel = createHighLevelClient(process.env);

const sentTouches = repo.allTouches().filter((t) => t.status === 'sent' && t.outcomeAt);

if (sentTouches.length === 0) {
  console.log('No sent touches yet — nothing to check replies for.');
  process.exit(0);
}

for (const touch of sentTouches) {
  const contact = await highlevel.upsertContact({
    firstName: touch.recipient.firstName,
    lastName: touch.recipient.lastName,
    email: touch.recipient.email,
    phone: touch.recipient.phone,
  });
  const history = await highlevel.getConversationHistory(contact.id);
  const newReplies = history.filter((m) => m.direction === 'inbound' && (m.dateAdded ?? '') > touch.outcomeAt!);

  if (newReplies.length === 0) continue;

  console.log('---');
  console.log(`Touch: ${touch.id}`);
  console.log(`Client: ${touch.recipient.firstName} ${touch.recipient.lastName}`);
  console.log(`Segment: ${touch.segmentKey}`);
  console.log(`Sent: ${touch.outcomeAt}`);
  console.log(`Original message: "${touch.message}"`);
  console.log(`New reply/replies since sent:`);
  for (const m of newReplies.reverse()) {
    console.log(`  [${m.dateAdded}] ${m.type}: ${m.body ?? '(no body)'}`);
  }
}
