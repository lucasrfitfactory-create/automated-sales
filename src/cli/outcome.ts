import 'dotenv/config';
import { Repository } from '../store/repository.js';
import type { TouchOutcome } from '../store/types.js';

const VALID: TouchOutcome[] = ['proposed', 'approved', 'edited', 'rejected', 'sent', 'converted', 'no_response'];

const [id, status, ...noteParts] = process.argv.slice(2);

if (!id || !status || !VALID.includes(status as TouchOutcome)) {
  console.error(`Usage: npm run outcome -- <touchId> <${VALID.join('|')}> [note]`);
  process.exit(1);
}

const repo = new Repository();
await repo.recordOutcome(id, status as TouchOutcome, noteParts.join(' ') || undefined);
console.log(`Recorded ${id} -> ${status}`);
