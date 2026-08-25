import 'dotenv/config';
import { computeSegmentStats, formatStatsTable } from '../store/stats.js';
import { Repository } from '../store/repository.js';

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

const repo = new Repository(STORE_PATH);
const stats = computeSegmentStats(repo.allTouches());

if (stats.length === 0) {
  console.log('No touches logged yet — run `npm run assess` first.');
} else {
  console.log(formatStatsTable(stats));
}
