import type { MtClassSession, MtClient, MtMembershipStatus } from '../marianaTek/types.js';
import type { ProposedAction } from '../rules/types.js';

export interface RecapItem {
  client: MtClient;
  classSession: MtClassSession;
  status: MtMembershipStatus;
  action: ProposedAction | null;
  skippedReason?: string; // set when a rule matched but we're not re-proposing (cooldown)
}

/** Human-readable status for the "no action needed" rows — without this every no-action row looked identical, hiding whether detection actually worked. */
function describeStatus(status: MtMembershipStatus): string {
  switch (status.kind) {
    case 'trial_offer':
      return `${status.offerName} (no rule matched)`;
    case 'class_pack':
      return `${status.packName} — ${status.classesRemaining}/${status.classesTotal} left${status.expiresAt ? `, exp ${status.expiresAt.slice(0, 10)}` : ''}`;
    case 'membership_active':
      return `active member (${status.planName})`;
    case 'membership_paused':
      return `paused member (${status.planName}${status.resumesAt ? `, resumes ${status.resumesAt.slice(0, 10)}` : ''})`;
    case 'membership_lapsed':
      return `${status.planName} (no rule matched)`;
    case 'no_active_status':
      return 'no active offer/membership/pack on file';
  }
}

export function buildRecapText(items: RecapItem[]): string {
  const byClass = new Map<string, { session: MtClassSession; items: RecapItem[] }>();
  for (const item of items) {
    const key = item.classSession.id;
    if (!byClass.has(key)) byClass.set(key, { session: item.classSession, items: [] });
    byClass.get(key)!.items.push(item);
  }

  const lines: string[] = [];
  const proposedCount = items.filter((i) => i.action).length;
  lines.push(`Fit Factory — Class Recap & Proposed Actions`);
  lines.push(`${byClass.size} class(es) assessed, ${items.length} attendee(s) reviewed, ${proposedCount} action(s) proposed.`);
  lines.push('');

  for (const { session, items: classItems } of byClass.values()) {
    lines.push(`━━━ ${session.className} — ${new Date(session.startTime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} (${session.instructor}) ━━━`);
    for (const item of classItems) {
      const name = `${item.client.firstName} ${item.client.lastName}`;
      if (item.action) {
        lines.push(`  • ${name} — ${item.action.segmentLabel}`);
        lines.push(`      Proposed: ${item.action.channel.toUpperCase()} — ${item.action.headline}`);
        lines.push(`      Draft: "${item.action.message}"`);
      } else if (item.skippedReason) {
        lines.push(`  • ${name} — ${item.skippedReason}`);
      } else {
        lines.push(`  • ${name} — no action needed (${describeStatus(item.status)})`);
      }
    }
    lines.push('');
  }

  lines.push('Reply to approve/edit any of the above, or say "send all" to approve everything as drafted.');
  return lines.join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** GFM markdown table — meant to be pasted directly into chat. */
export function buildRecapTable(items: RecapItem[]): string {
  const header = '| Class | Client | Status | Action | Draft |\n|---|---|---|---|---|';
  const rows = items.map((item) => {
    const cls = `${item.classSession.className} (${new Date(item.classSession.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
    const name = `${item.client.firstName} ${item.client.lastName}`;
    if (item.action) {
      return `| ${cls} | ${name} | ${escapeCell(item.action.segmentLabel)} | **${item.action.channel.toUpperCase()}**: ${escapeCell(item.action.headline)} | ${escapeCell(item.action.message)} |`;
    }
    if (item.skippedReason) {
      return `| ${cls} | ${name} | ${escapeCell(item.skippedReason)} | _skipped (cooldown)_ | — |`;
    }
    return `| ${cls} | ${name} | ${escapeCell(describeStatus(item.status))} | _no action needed_ | — |`;
  });
  return [header, ...rows].join('\n');
}
