import type { TouchLogEntry } from './types.js';

export interface SegmentStats {
  segmentKey: string;
  total: number;
  approved: number; // approved or sent
  rejected: number;
  converted: number;
  pending: number; // still 'proposed', no decision yet
  approvalRate: number | null; // approved / (approved + rejected), null if no decisions yet
}

/**
 * Groups touch-log entries by segment and tallies outcomes — this is the
 * "did it work?" view the learning loop is built on. Once we're sending for
 * real and outcomes flow back (approved/rejected/converted), a segment with
 * a low approval rate or zero conversions after enough attempts is a
 * candidate to rewrite in src/rules/playbook.ts; a segment that converts
 * well is a candidate to reuse the same approach elsewhere.
 */
export function computeSegmentStats(entries: TouchLogEntry[]): SegmentStats[] {
  const bySegment = new Map<string, TouchLogEntry[]>();
  for (const e of entries) {
    if (!bySegment.has(e.segmentKey)) bySegment.set(e.segmentKey, []);
    bySegment.get(e.segmentKey)!.push(e);
  }

  const stats: SegmentStats[] = [];
  for (const [segmentKey, touches] of bySegment) {
    const approved = touches.filter((t) => t.status === 'approved' || t.status === 'sent').length;
    const rejected = touches.filter((t) => t.status === 'rejected').length;
    const converted = touches.filter((t) => t.status === 'converted').length;
    const pending = touches.filter((t) => t.status === 'proposed').length;
    const decided = approved + rejected;
    stats.push({
      segmentKey,
      total: touches.length,
      approved,
      rejected,
      converted,
      pending,
      approvalRate: decided > 0 ? approved / decided : null,
    });
  }
  return stats.sort((a, b) => b.total - a.total);
}

export function formatStatsTable(stats: SegmentStats[]): string {
  const header = '| Segment | Proposed | Approved | Rejected | Converted | Pending | Approval rate |\n|---|---|---|---|---|---|---|';
  const rows = stats.map(
    (s) =>
      `| ${s.segmentKey} | ${s.total} | ${s.approved} | ${s.rejected} | ${s.converted} | ${s.pending} | ${s.approvalRate === null ? '—' : `${Math.round(s.approvalRate * 100)}%`} |`
  );
  return [header, ...rows].join('\n');
}
