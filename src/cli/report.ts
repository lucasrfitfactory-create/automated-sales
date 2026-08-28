import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Repository } from '../store/repository.js';
import type { TouchLogEntry } from '../store/types.js';

// Generates the static TV/recap HTML page (docs/index.html) from local data
// only — no live API calls, so it's fast and safe to run after every job.
// Hosted via GitHub Pages (repo Settings -> Pages -> Deploy from branch ->
// /docs) once Lucas pushes it; regenerate + push after every gather/send/
// conversions run to keep it current.

interface ConversionLogEntry {
  contactId: string;
  name: string;
  planName: string;
  memberSince: string;
  daysToConvert: number;
  segmentKey: string;
  recordedAt: string;
}
interface TargetingFlag {
  contactId: string;
  name: string;
  memberSince: string;
  touchDate: string;
  flaggedAt: string;
}
interface ConversionLog {
  conversions: ConversionLogEntry[];
  targetingFlags: TargetingFlag[];
}
interface GoldenRule {
  title: string;
  detail: string;
  addedAt: string;
}

const repo = new Repository();
const touches = await repo.allTouches();

const conversionLog: ConversionLog = existsSync('data/conversion-log.json')
  ? JSON.parse(readFileSync('data/conversion-log.json', 'utf8'))
  : { conversions: [], targetingFlags: [] };
const goldenRules: GoldenRule[] = existsSync('data/golden-rules.json') ? JSON.parse(readFileSync('data/golden-rules.json', 'utf8')) : [];

// Historical gather snapshots — the only place a candidate's original,
// specific Mariana Tek status (offer name, pack name) is recorded, since
// the touch log only keeps the segment key, not the raw status.
const gatherStatusByContact = new Map<string, any>();
if (existsSync('data/gather')) {
  for (const f of readdirSync('data/gather')) {
    if (!f.endsWith('.json')) continue;
    let items: any[];
    try {
      items = JSON.parse(readFileSync(`data/gather/${f}`, 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item.type === 'candidate') gatherStatusByContact.set(item.contactId, item.status);
    }
  }
}

const isFollowUp = (t: TouchLogEntry) => t.id.startsWith('followup:') || t.segmentKey.endsWith('_followup');
const wentOut = touches.filter((t) => t.status === 'sent' || t.status === 'converted');
const followUps = wentOut.filter(isFollowUp);
const primary = wentOut.filter((t) => !isFollowUp(t));

const contactedIds = new Set(wentOut.map((t) => t.contactId));
const convertedIds = new Set(touches.filter((t) => t.status === 'converted').map((t) => t.contactId));

const peopleContacted = contactedIds.size;
const followUpCount = followUps.length;
const conversionCount = convertedIds.size;
const conversionRate = peopleContacted > 0 ? (conversionCount / peopleContacted) * 100 : 0;

function category(label: string, match: (t: TouchLogEntry) => boolean) {
  const ids = new Set(primary.filter(match).map((t) => t.contactId));
  const converted = [...ids].filter((id) => convertedIds.has(id));
  return {
    label,
    count: ids.size,
    convertedCount: converted.length,
    pct: peopleContacted > 0 ? (ids.size / peopleContacted) * 100 : 0,
    convertedPct: ids.size > 0 ? (converted.length / ids.size) * 100 : 0,
  };
}

const categories = [
  category('ClassPass guests', (t) => t.segmentKey.startsWith('classpass')),
  category('Intro / trial offers', (t) => t.segmentKey.startsWith('trial_') || t.segmentKey === 'no_status_intro_pitch'),
  category('Class pack running low/expiring', (t) => t.segmentKey.startsWith('class_pack')),
  category('Frequent, no membership on file', (t) => t.segmentKey === 'no_status_frequent_pitch_membership'),
  category('Lapsed member win-back', (t) => t.segmentKey === 'membership_lapsed_winback'),
  category('Personal negotiation (closed by Lucas)', (t) => t.segmentKey === 'personal_negotiation_close'),
];

// Specific intro-offer breakdown — by the REAL Mariana Tek offer name at
// contact time, not the generic segment key (several segment keys share
// one offer name, and one segment key can span several offer names). One
// row per unique CONTACT (not per touch) so this total matches the "Intro
// / trial offers" card above — a contact with two touches in this bucket
// (e.g. the original text plus a same-conversation commitment-ask reply)
// would otherwise double-count.
const introOfferLabelByContact = new Map<string, string>();
for (const t of primary) {
  if (!(t.segmentKey.startsWith('trial_') || t.segmentKey === 'no_status_intro_pitch')) continue;
  if (introOfferLabelByContact.has(t.contactId)) continue;
  const status = gatherStatusByContact.get(t.contactId);
  const label = status?.kind === 'trial_offer' ? status.offerName : '$39 1-Week Trial (offered, nothing on file yet)';
  introOfferLabelByContact.set(t.contactId, label);
}
const introOfferCounts = new Map<string, number>();
for (const label of introOfferLabelByContact.values()) {
  introOfferCounts.set(label, (introOfferCounts.get(label) ?? 0) + 1);
}
const introOfferRows = [...introOfferCounts.entries()].sort((a, b) => b[1] - a[1]);

const failedSends = touches.filter((t) => t.status === 'rejected' && t.outcomeNote?.includes('send failed'));
const storePath = process.env.STORE_PATH ?? 'data/store.json';
const rawStore = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : { processedClassSessions: {} };
const classesProcessed = Object.keys(rawStore.processedClassSessions ?? {}).length;
const lastGatherCursor = await repo.getCursor('gather_since');

const recentConversions = [...conversionLog.conversions].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
const recentFlags = [...conversionLog.targetingFlags].sort((a, b) => b.flaggedAt.localeCompare(a.flaggedAt));

const now = new Date();
const updatedDisplay = now.toLocaleString('en-CA', {
  timeZone: 'America/Toronto',
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric' });
}
function pct(n: number): string {
  return `${Math.round(n)}%`;
}

const categoryCardsHtml = categories
  .map(
    (c) => `
      <div class="card">
        <div class="card-label">${esc(c.label)}</div>
        <div class="card-value">${c.count}</div>
        <div class="card-sub">${pct(c.pct)} of everyone contacted</div>
        <div class="mini-bar"><div class="mini-bar-fill" style="width:${Math.min(c.pct, 100)}%"></div></div>
        <div class="card-footnote">${c.convertedCount} converted${c.count > 0 ? ` (${pct(c.convertedPct)})` : ''}</div>
      </div>`,
  )
  .join('\n');

const introOfferRowsHtml = introOfferRows.length
  ? introOfferRows
      .map(
        ([label, count]) => `
      <div class="offer-row">
        <span class="offer-name">${esc(label)}</span>
        <span class="offer-count">${count}</span>
      </div>`,
      )
      .join('\n')
  : '<div class="empty-note">No intro/trial contacts yet.</div>';

const rulesHtml = goldenRules
  .map(
    (r) => `
      <div class="rule">
        <div class="rule-title">${esc(r.title)}</div>
        <div class="rule-detail">${esc(r.detail)}</div>
      </div>`,
  )
  .join('\n');

const conversionsHtml = recentConversions.length
  ? recentConversions
      .slice(0, 8)
      .map(
        (c) => `
      <div class="list-row">
        <div>
          <div class="list-row-name">${esc(c.name)}</div>
          <div class="list-row-sub">${esc(c.planName)}</div>
        </div>
        <div class="list-row-right">
          <div class="list-row-value good">${fmtDate(c.memberSince)}</div>
          <div class="list-row-sub">${c.daysToConvert}d after outreach</div>
        </div>
      </div>`,
      )
      .join('\n')
  : '<div class="empty-note">No conversions recorded yet.</div>';

const flagsHtml = recentFlags.length
  ? recentFlags
      .slice(0, 8)
      .map(
        (f) => `
      <div class="list-row">
        <div>
          <div class="list-row-name">${esc(f.name)}</div>
          <div class="list-row-sub">member since ${fmtDate(f.memberSince)}</div>
        </div>
        <div class="list-row-right">
          <div class="list-row-value warn">caught</div>
          <div class="list-row-sub">touched ${fmtDate(f.touchDate)}</div>
        </div>
      </div>`,
      )
      .join('\n')
  : '<div class="empty-note">None caught — no known targeting misses.</div>';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Fit Factory — Automation Recap</title>
<style>
  :root {
    --bg: #0a0e16;
    --panel: #10151f;
    --panel-border: #1e2532;
    --text: #f2f4f8;
    --text-dim: #8891a3;
    --text-faint: #5a6272;
    --accent-orange: #f5a623;
    --accent-green: #34d399;
    --accent-red: #f26161;
    --accent-blue: #4ea1ff;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; width: 100vw; height: 100vh; overflow: hidden;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .page { display: flex; flex-direction: column; height: 100vh; width: 100vw; padding: 1.4vh 1.6vw; gap: 1.2vh; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 0 0.4vw; }
  .brand { font-size: 1.6vw; font-weight: 800; letter-spacing: 0.12em; }
  .brand .dot { color: var(--accent-orange); }
  .header-right { text-align: right; font-size: 0.85vw; color: var(--text-dim); line-height: 1.5; }
  .header-right .live { color: var(--accent-green); font-weight: 600; }
  .header-sub { font-size: 0.85vw; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }

  .top-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1vw; }
  .big-card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 1.4vh 1.2vw; }
  .big-label { font-size: 0.8vw; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.6vh; }
  .big-value { font-size: 2.6vw; font-weight: 800; line-height: 1; }
  .big-value .frac { font-size: 1.3vw; color: var(--text-dim); font-weight: 500; }
  .big-note { font-size: 0.8vw; color: var(--text-dim); margin-top: 0.6vh; }
  .big-note.good { color: var(--accent-green); }

  .mid-row { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.8vw; flex: 0 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 1vh 0.9vw; display: flex; flex-direction: column; }
  .card-label { font-size: 0.68vw; letter-spacing: 0.04em; color: var(--text-dim); text-transform: uppercase; min-height: 2.4em; }
  .card-value { font-size: 1.7vw; font-weight: 800; margin-top: 0.3vh; }
  .card-sub { font-size: 0.65vw; color: var(--text-faint); margin-top: 0.2vh; }
  .mini-bar { height: 5px; background: #1c2330; border-radius: 3px; margin-top: 0.6vh; overflow: hidden; }
  .mini-bar-fill { height: 100%; background: var(--accent-orange); }
  .card-footnote { font-size: 0.68vw; color: var(--accent-green); margin-top: 0.5vh; font-weight: 600; }

  .bottom-row { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 1vw; flex: 1; min-height: 0; }
  .panel { background: var(--panel); border: 1px solid var(--panel-border); border-radius: 10px; padding: 1.2vh 1.1vw; display: flex; flex-direction: column; min-height: 0; }
  .panel-title { font-size: 0.85vw; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-dim); margin-bottom: 0.8vh; flex: 0 0 auto; }
  .panel-scroll { overflow-y: auto; flex: 1; min-height: 0; }
  .panel-scroll::-webkit-scrollbar { width: 4px; }
  .panel-scroll::-webkit-scrollbar-thumb { background: var(--panel-border); border-radius: 2px; }

  .rule { padding: 0.7vh 0; border-bottom: 1px solid var(--panel-border); }
  .rule:last-child { border-bottom: none; }
  .rule-title { font-size: 0.78vw; font-weight: 700; color: var(--text); }
  .rule-title::before { content: "✓ "; color: var(--accent-green); }
  .rule-detail { font-size: 0.68vw; color: var(--text-dim); margin-top: 0.15vh; line-height: 1.4; }

  .offer-row { display: flex; justify-content: space-between; padding: 0.55vh 0; border-bottom: 1px solid var(--panel-border); font-size: 0.75vw; }
  .offer-row:last-child { border-bottom: none; }
  .offer-name { color: var(--text-dim); }
  .offer-count { font-weight: 700; }

  .list-row { display: flex; justify-content: space-between; align-items: flex-start; padding: 0.6vh 0; border-bottom: 1px solid var(--panel-border); gap: 0.6vw; }
  .list-row:last-child { border-bottom: none; }
  .list-row-name { font-size: 0.78vw; font-weight: 700; }
  .list-row-sub { font-size: 0.65vw; color: var(--text-faint); margin-top: 0.1vh; }
  .list-row-right { text-align: right; flex: 0 0 auto; }
  .list-row-value { font-size: 0.75vw; font-weight: 700; }
  .list-row-value.good { color: var(--accent-green); }
  .list-row-value.warn { color: var(--accent-orange); }

  .empty-note { font-size: 0.75vw; color: var(--text-faint); padding: 1vh 0; }

  .footer-strip { display: flex; justify-content: space-between; font-size: 0.68vw; color: var(--text-faint); padding: 0 0.4vw; flex: 0 0 auto; }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand">FIT FACT<span class="dot">O</span>RY <span style="color:var(--text-dim); font-weight:500; letter-spacing:0.08em; font-size:0.85vw;">— AUTOMATION RECAP</span></div>
    <div class="header-right">
      <div><span class="live">● Live</span> · Updated ${esc(updatedDisplay)}</div>
      <div>Data refreshes every time the job runs</div>
    </div>
  </div>

  <div class="top-row">
    <div class="big-card">
      <div class="big-label">People Contacted</div>
      <div class="big-value">${peopleContacted}</div>
      <div class="big-note">Unique clients texted or emailed by the pipeline</div>
    </div>
    <div class="big-card">
      <div class="big-label">Follow-ups Sent</div>
      <div class="big-value">${followUpCount}</div>
      <div class="big-note">Email follow-ups after 2+ days of no reply</div>
    </div>
    <div class="big-card">
      <div class="big-label">Conversions</div>
      <div class="big-value">${conversionCount} <span class="frac">/ ${peopleContacted}</span></div>
      <div class="big-note good">${pct(conversionRate)} of everyone contacted</div>
    </div>
  </div>

  <div class="mid-row">
    ${categoryCardsHtml}
  </div>

  <div class="bottom-row">
    <div class="panel">
      <div class="panel-title">Golden Rules</div>
      <div class="panel-scroll">
        ${rulesHtml}
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Intro / Trial Offers — by type</div>
      <div class="panel-scroll">
        ${introOfferRowsHtml}
      </div>
      <div class="panel-title" style="margin-top:1vh;">Recent Conversions</div>
      <div class="panel-scroll">
        ${conversionsHtml}
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">Targeting Corrections Caught</div>
      <div class="panel-scroll">
        ${flagsHtml}
      </div>
      <div class="panel-title" style="margin-top:1vh;">Operational Notes</div>
      <div class="panel-scroll">
        <div class="offer-row"><span class="offer-name">Failed sends (missing phone, etc.)</span><span class="offer-count">${failedSends.length}</span></div>
        <div class="offer-row"><span class="offer-name">Classes processed to date</span><span class="offer-count">${classesProcessed}</span></div>
        <div class="offer-row"><span class="offer-name">Pipeline cursor (last gather-through)</span><span class="offer-count" style="font-size:0.62vw;">${lastGatherCursor ? esc(fmtDate(lastGatherCursor)) : '—'}</span></div>
      </div>
    </div>
  </div>

  <div class="footer-strip">
    <span>Fit Factory Downtown — Personalized, chat-driven outreach. Every send approved by Lucas.</span>
    <span>Generated by the automated-sales pipeline</span>
  </div>
</div>
</body>
</html>
`;

mkdirSync('docs', { recursive: true });
writeFileSync('docs/index.html', html);
console.log('Wrote docs/index.html');
