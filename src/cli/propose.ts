import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Repository } from '../store/repository.js';
import type { TouchLogEntry } from '../store/types.js';

// Step 2 of 2. Takes a JSON file of finished, personalized touches — drafted
// by whoever ran `npm run gather` first (Claude, live in chat, reading each
// candidate's real account/attendance context) — and records them in the
// touch log as status 'proposed'. This is what the recap approval flow and
// `npm run send` then operate on, same as before.
//
// Input shape: an array of
//   { contactId, firstName, lastName, email, phone, classSessionId,
//     segmentKey, channel, headline, message, followUp? }
// (a trimmed-down version of a gather.ts "candidate", with referenceHeadline/
// referenceMessage replaced by the actual drafted headline/message).
//
// Guardrails enforced here, not just by convention: no em-dash in any
// client-facing text (Lucas, 2026-08-26 — broke this rule badly enough
// once that it's worth a hard check, not just a reminder), and no empty
// message.

interface ProposeInput {
  contactId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  classSessionId: string;
  segmentKey: string;
  channel: 'email' | 'text';
  headline: string;
  message: string;
  followUp?: { channel: 'email'; headline: string; message: string; afterDays: number };
}

const [filePath] = process.argv.slice(2);
if (!filePath) {
  console.error('Usage: npm run propose -- <path-to-drafted-candidates.json>');
  process.exit(1);
}

const raw = readFileSync(filePath, 'utf-8');
const inputs: ProposeInput[] = JSON.parse(raw);

function containsEmDash(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => t?.includes('—'));
}

const repo = new Repository();
const now = new Date().toISOString();

let recorded = 0;
let rejected = 0;

for (const input of inputs) {
  if (!input.message?.trim() || !input.headline?.trim()) {
    console.error(`SKIPPED ${input.contactId} (${input.firstName} ${input.lastName}): empty headline/message.`);
    rejected++;
    continue;
  }
  if (containsEmDash(input.message, input.headline, input.followUp?.message, input.followUp?.headline)) {
    console.error(`SKIPPED ${input.contactId} (${input.firstName} ${input.lastName}): em-dash ("—") found in client-facing text — not allowed.`);
    rejected++;
    continue;
  }

  const entry: TouchLogEntry = {
    id: `${input.classSessionId}:${input.contactId}:${input.segmentKey}:${now}`,
    contactId: input.contactId,
    segmentKey: input.segmentKey,
    channel: input.channel,
    classSessionId: input.classSessionId,
    proposedAt: now,
    status: 'proposed',
    recipient: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone },
    headline: input.headline,
    message: input.message,
    followUp: input.followUp,
  };
  await repo.recordTouch(entry);
  console.log(`Recorded ${entry.id} — ${entry.channel.toUpperCase()} to ${input.firstName} ${input.lastName}.`);
  recorded++;
}

console.log(`\nDone: ${recorded} recorded, ${rejected} rejected.`);
if (rejected > 0) process.exitCode = 1;
