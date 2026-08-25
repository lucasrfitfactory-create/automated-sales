import 'dotenv/config';
import { Repository } from '../store/repository.js';
import type { TouchOutcome } from '../store/types.js';

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';
const VALID: TouchOutcome[] = ['proposed', 'approved', 'edited', 'rejected', 'sent', 'converted', 'no_response'];

const [id, status, ...noteParts] = process.argv.slice(2);

if (!id || !status || !VALID.includes(status as TouchOutcome)) {
  console.error(`Usage: npm run outcome -- <touchId> <${VALID.join('|')}> [note]`);
  process.exit(1);
}

const repo = new Repository(STORE_PATH);
repo.recordOutcome(id, status as TouchOutcome, noteParts.join(' ') || undefined);
repo.save();
console.log(`Recorded ${id} -> ${status}`);
