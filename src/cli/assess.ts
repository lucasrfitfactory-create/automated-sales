import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createMarianaTekClient } from '../marianaTek/index.js';
import { buildRecapText, type RecapItem } from '../recap/buildRecap.js';
import { evaluate } from '../rules/engine.js';
import { PLAYBOOK } from '../rules/playbook.js';
import { Repository } from '../store/repository.js';

const LOOKBACK_DAYS = Number(process.env.ASSESS_LOOKBACK_DAYS ?? 14);
const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

async function main() {
  const locationId = process.env.MARIANA_TEK_LOCATION_ID;
  if (!locationId) throw new Error('MARIANA_TEK_LOCATION_ID is not set (see .env.example).');

  const mariana = createMarianaTekClient(process.env);
  const repo = new Repository(STORE_PATH);

  const now = new Date();
  const since = new Date(now);
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const sessions = await mariana.getClassSessions({
    locationId,
    since: since.toISOString(),
    before: now.toISOString(),
  });

  const unprocessed = sessions.filter((s) => !repo.isClassProcessed(s.id));

  if (unprocessed.length === 0) {
    console.log(`No unprocessed classes in the last ${LOOKBACK_DAYS} days.`);
    return;
  }

  const items: RecapItem[] = [];

  for (const session of unprocessed) {
    const roster = await mariana.getRoster(session.id);
    for (const entry of roster) {
      if (!entry.attended) continue;
      const [client, status] = await Promise.all([
        mariana.getClient(entry.clientId),
        mariana.getMembershipStatus(entry.clientId),
      ]);

      const action = evaluate({ client, status, classSession: session, now }, PLAYBOOK);

      if (!action) {
        items.push({ client, classSession: session, action: null });
        continue;
      }

      const lastTouch = repo.getLastTouch(client.id, action.segmentKey);
      if (lastTouch) {
        const daysSince = Math.round((now.getTime() - new Date(lastTouch.proposedAt).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSince < action.cooldownDays) {
          items.push({
            client,
            classSession: session,
            action: null,
            skippedReason: `${action.segmentLabel} — already contacted ${daysSince}d ago (cooldown ${action.cooldownDays}d), skipping`,
          });
          continue;
        }
      }

      items.push({ client, classSession: session, action });
      repo.recordTouch({
        id: `${session.id}:${client.id}:${action.segmentKey}:${now.toISOString()}`,
        contactId: client.id,
        segmentKey: action.segmentKey,
        channel: action.channel,
        classSessionId: session.id,
        proposedAt: now.toISOString(),
        status: 'proposed',
      });
    }
    repo.markClassProcessed(session.id);
  }

  repo.save();

  const recap = buildRecapText(items);
  console.log(recap);

  mkdirSync('data/recaps', { recursive: true });
  const recapPath = `data/recaps/${now.toISOString().replace(/[:.]/g, '-')}.md`;
  writeFileSync(recapPath, recap);
  console.error(`\n(recap saved to ${recapPath})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
