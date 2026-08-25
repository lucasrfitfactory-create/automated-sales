import type { MtClassSession, MtClient } from '../marianaTek/types.js';
import type { ProposedAction } from '../rules/types.js';

export interface RecapItem {
  client: MtClient;
  classSession: MtClassSession;
  action: ProposedAction | null;
  skippedReason?: string; // set when a rule matched but we're not re-proposing (cooldown)
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
        lines.push(`  • ${name} — no action needed`);
      }
    }
    lines.push('');
  }

  lines.push('Reply to approve/edit any of the above, or say "send all" to approve everything as drafted.');
  return lines.join('\n');
}
