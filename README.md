# Fit Factory — Automated Sales Agent

Reads class rosters from Mariana Tek, checks each attendee's membership/pack/
intro-offer status, and drafts a personalized follow-up (email or text).
Deliberately **not** an unattended background job: Lucas launches it from a
chat with Claude, Claude reads each attendee's real account/attendance data
and writes their message itself (not a fixed template), then Lucas reviews
and approves before anything sends through HighLevel. This is also how the
learning loop stays real — Claude is the one reading replies and Lucas's own
decisions each run, not a script pattern-matching keywords.

## Status

- **Mariana Tek**: **live** — API access came through 2026-08-26, and the
  real client has been validated against five full real "yesterday" recap
  runs (214→158→157→157→157 real attendees), each surfacing and fixing a
  real bug: wrong-business pitches (Refined Reformer/PSC products bleeding
  into the Fit Factory playbook), expired trials misread as generic
  lapsed-membership win-backs, frozen real memberships misread as lapsed
  (status is literally `'frozen'`, not `'active'`), class packs not
  detected at all, and — the last one — the recap itself showing the same
  generic "no active offer/pack" label for every no-action row regardless
  of the real reason, which was hiding that detection was mostly already
  working. All fixed and reverified; see `realClient.ts`'s top comment for
  everything confirmed empirically (their docs site stays gated even with
  the key). `MARIANA_TEK_MODE=real` is set in `.env`; flip back to `mock`
  to iterate against safe seeded data instead.
- **Rules playbook** (`src/rules/playbook.ts`): still the source of truth
  for *which* product applies to each segment, cooldowns, and pricing — the
  3 confirmed paths ($39 1-week trial, $99 1-month trial/Comeback/
  ClassPass-purchase, ClassPass guest booking) are real. What it returns is
  now a **compliant reference draft**, not the final message — `npm run
  gather` surfaces it as `referenceMessage`/`referenceHeadline`, and Claude
  personalizes the actual wording per contact (real attendance pattern,
  specific offer, tone) before it gets recorded, while keeping the
  reference's hard constraints intact. Cadence stays **text-first**: every
  sales touch is a short single-product text, with an email follow-up if
  there's no reply within `followUp.afterDays` (2 days default, 1 day for
  urgent "trial ends in ≤2/3 days" touches). Copy rules, confirmed the hard
  way after two rounds of real feedback and enforced by `npm run propose`
  where possible (see "How it works" below): exactly one product per
  message (no "or", not even framed as a choice), always ends on a direct
  close ("Want me to set that up for you?"), never a savings claim unless
  the math actually holds, never an em-dash. A live Class Pack Sale (20
  classes/$349, ends Aug 31) is pushed as that one product to
  ClassPass-related and expiring-pack segments while active — see
  `pricing.ts`'s `isClassPackSaleActive()`, which turns it off on its own
  after the deadline. Only 'Group Fitness' classroom classes are in scope
  (PSC/Refined Reformer excluded). Class-pack-low (non-sale baseline),
  genuine lapsed-real-membership win-back, and generic-walk-in rules are
  still **placeholder** — haven't been reviewed against the real playbook.
  Open question from the first real run: how stale can a lapsed membership
  be before it's not worth a win-back (saw one 19-21 months lapsed).
- **Pricing** (`src/rules/pricing.ts`): confirmed with Lucas 2026-08-25 —
  Weekly Unlimited is $49/wk (12mo), $59/wk (6mo), $69/wk (3mo). "Comeback
  Offer" naming confirmed against a real membership_instance ("🎯 COMEBACK
  SPECIAL- 3 MONTH UNLIMITED"); haven't yet seen a real $99 1-month trial or
  ClassPass-purchase instance to confirm those exact name strings.
- **HighLevel** (`src/highlevel/`): client built against their public,
  verified API docs (contacts/upsert, conversations/messages) — real
  schemas, not guesses. Runs in mock mode until Lucas generates a **Private
  Integration Token** (no external approval needed, unlike Mariana Tek —
  see Setup below) and sets `HIGHLEVEL_MODE=real`.
- **Recap delivery**: printed as a markdown table in chat, live, as part of
  Claude drafting and proposing each message — see "How it works" below.
- **Store**: local JSON file (`data/store.json`, gitignored) — processed
  classes, the full touch log, and the gather cursor. This runs as a chat
  session on Lucas's own machine, not an ephemeral cloud runner, so a local
  file surviving between sessions is all the durability this needs.

## How it works

This is a **two-step, chat-driven** pipeline — Lucas asks Claude to run it
(in a Claude Code session, whenever he wants, not on an unattended
schedule), and Claude does both steps in the same conversation:

1. **`npm run gather`** — pulls every class session between wherever the
   pipeline left off (the `gather_since` cursor in `data/store.json`) and right now, filtered
   to 'Group Fitness' classroom only, that haven't been processed yet. No
   fixed lookback window: this is what makes "catch up since I last ran it"
   work regardless of the gap. (First-ever run, with no cursor yet, falls
   back to `GATHER_INITIAL_LOOKBACK_HOURS`, default 24h; `ASSESS_SINCE`/
   `ASSESS_BEFORE` still override both for an explicit calendar-day range.)
   For each attendee, fetches their real membership/pack/trial status and
   30-day attendance count, and matches it against `PLAYBOOK`
   (`src/rules/playbook.ts`) to find which segment/product/cooldown
   applies — first matching rule wins, same as before. Writes everything to
   `data/gather/<timestamp>.json` as a candidate manifest and marks those
   classes processed. Does **not** touch the touch log yet.
2. **Claude reads that manifest** and, for each real candidate, writes the
   actual message — referencing their specific attendance/account details
   (e.g. "I see you trained 3 times last week"), not the generic
   `referenceMessage` the playbook produced, while keeping its hard
   constraints (single product, correct price, direct close, no em-dash).
   Anyone flagged with `priorRejections` (a past touch Lucas rejected with a
   note) gets called out to Lucas instead of silently re-proposed.
3. Claude presents the drafted recap in chat. Lucas approves, edits, or
   rejects each item.
4. **`npm run propose -- <file>`** — Claude writes the approved/edited
   drafts to a JSON file and runs this to record them in the touch log as
   `status: 'proposed'`. Rejects (doesn't record) anything with an empty
   message or an em-dash, as a hard backstop on top of Claude's own care.
5. **`npm run send -- <touchId> [touchId ...] | all`** — dispatches exactly
   the touches Lucas approved through HighLevel. Never automatic.
6. **`npm run check-replies`** — Claude reads new replies (raw, no
   keyword-classification) and flags anything that looks like a yes as
   **IMPORTANT** for Lucas to go process manually (see "Sales processing"
   below), and queues due email follow-ups.
7. **`npm run stats`** — segment-level approval/rejection/conversion rates,
   the quantitative half of the learning loop (see "Learning loop" below).

## Setup

```bash
npm install
cp .env.example .env   # fill in as integrations go live; mock mode needs no changes
npm run gather
```

Code is hosted on GitHub (`lucasrfitfactory-create/automated-sales`) for
version control and backup, but nothing runs there — every run happens in a
chat session on Lucas's own machine, launched on demand.

### Getting a HighLevel Private Integration Token

Unlike Mariana Tek, this doesn't need external approval — Lucas can do this
directly, in a couple minutes:

1. In the HighLevel sub-account (app.autocallerai.ca), go to **Settings ->
   Private Integrations**.
2. Create a new integration, scoped to `contacts.write`,
   `conversations/message.write`, `conversations/message.readonly`, and
   `conversations.readonly`. The two read scopes aren't used by v1 yet, but
   they're what the learning loop needs later (checking whether a client
   already replied) — cheaper to grant now than to re-scope the token later.
3. Copy the generated token into `.env` as `HIGHLEVEL_PRIVATE_TOKEN`, and
   set `HIGHLEVEL_LOCATION_ID` (from the dashboard URL:
   `.../location/XBLL0vgIMtnUgHBUu2du/...`) and `HIGHLEVEL_MODE=real`.

## Learning loop

The touch log (`data/store.json`) is more than a
dedup/cooldown mechanism — it's the record the "keep what works, adapt what
doesn't" loop runs on, and it has two halves:

**Quantitative** (automatic, works without Claude in the loop):
1. Every proposed action from `npm run propose` is logged with `status:
   'proposed'`.
2. As Lucas approves/edits/rejects items from a recap, `npm run outcome --
   <touchId> <approved|edited|rejected|sent>` records it. Once messages are
   actually sent and we can tell if someone converted, `converted` closes
   the loop.
3. `npm run stats` reports approval/rejection/conversion rates per segment
   (`trial_1week_convert`, `classpass_guest_pitch`, etc.).

**Qualitative** (needs judgment — this is why the pipeline is chat-driven,
not an unattended job): stats alone don't say *why* a segment keeps getting
rejected, or whether one rejection is a real pattern versus a one-off
exception. That reading is done by Claude, live, drawing on what actually
happened this run — replies from clients (via `npm run check-replies`),
Lucas's own edits/rejections in chat, and the stats above — before deciding
a segment's copy or trigger in `src/rules/playbook.ts` is actually worth
rewriting. The rule of thumb: change a rule only after ruling out a one-off
exception, not on a single data point. This is manual/assisted (Claude reads
the evidence and proposes the edit, Lucas approves the diff) rather than
Claude silently rewriting the playbook on its own.

## Operating protocol

- **No em-dashes ("—") in any client-facing text or email, ever** (Lucas,
  2026-08-26). Applies to `message` and `followUp.message` content only —
  internal recap formatting (section separators, labels) is exempt.
- **Validation window: 2026-08-26 through 2026-08-28.** Every run's report
  to Lucas includes three things: (1) what's being proposed to send today,
  (2) what follow-ups are queued/being handled, (3) what's been learned so
  far (stats, patterns, anything that changed). Nothing sends without his
  explicit approval during this window. After 2026-08-28, if validated,
  Claude can send autonomously without per-batch approval — but keeps
  logging and reporting the same way.

## Sales processing (confirmed 2026-08-26: manual, permanently)

Mariana Tek has no purchase-creation API (confirmed by their support team) —
membership sales only happen through the POS checkout flow in their Admin
dashboard, which requires manually typing card details. Separately, browser
automation into that same admin domain is blocked at the platform level for
this session regardless of which account is used. Between those two facts,
Claude will never be the one directly processing a sale in Mariana Tek.

What Claude does instead: `npm run check-replies` reviews every touch
that's actually been sent (`status: 'sent'`) two ways every time it's run
(per Lucas 2026-08-26 — this is a standing part of "the job", not just an
on-demand reply check):

1. **New replies**, via HighLevel's conversation history. Deliberately does
   NOT try to auto-classify a reply as "yes" — freeform text is too varied
   to trust a keyword match with something this consequential. Claude reads
   them and flags anything that looks like agreement as **IMPORTANT** when
   reporting back, so Lucas knows exactly which sales to go process
   manually.
2. **Due follow-ups** — a text got no reply and `followUp.afterDays` has
   passed. Queues the email follow-up as a new `'proposed'` touch, same
   approval flow as anything from `npm run gather`/`propose`. Verified
   idempotent — never queued twice for the same original touch.

Not scheduled/continuous yet — run on demand until a periodic check is
wired up.

## Next steps

- Get real trigger/copy details for class-pack-low (now that packs are
  detected, `classesRemaining` is real — just needs Lucas's real
  threshold/copy), genuine lapsed-real-membership win-back (including a
  staleness cutoff), and generic-walk-in segments to replace their
  placeholders in `src/rules/playbook.ts`.
- Push this repo to a remote (currently local-only, no git remote
  configured) if Lucas wants it backed up/shareable.
- Wire `npm run check-replies` into a scheduled/periodic check instead of
  on-demand only, so IMPORTANT flags surface without Lucas having to ask.
- Feed real conversion outcomes back through `npm run outcome` and start
  actually rewriting playbook rules based on `npm run stats`.
