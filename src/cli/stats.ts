import 'dotenv/config';
import { computeSegmentStats, formatStatsTable } from '../store/stats.js';
import { Repository } from '../store/repository.js';

const repo = new Repository();
const stats = computeSegmentStats(await repo.allTouches());

if (stats.length === 0) {
  console.log('No touches logged yet — run `npm run gather` first.');
} else {
  console.log(formatStatsTable(stats));
}
