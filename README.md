# Fit Factory — Automated Sales Agent

Reads class rosters from Mariana Tek, checks each attendee's membership/pack/
intro-offer status, and proposes a follow-up action (email or text) based on
a rules playbook. Nothing sends on its own — Lucas reviews the recap in chat
and approves items one at a time; only then does `npm run send` dispatch
that specific message through HighLevel.

## Status

- **Mariana Tek**: **live** — API access came through 2026-08-26.
  `src/marianaTek/realClient.ts` is verified end-to-end against real data
  (see its top comment for exactly what was confirmed empirically, since
  their docs site stays gated even with the key). Two known gaps: class
  packs aren't detected yet (no pack/credit resource found so far — those
  clients currently read as `no_active_status`), and `membership_paused`'s
  shape is assumed, never observed on a real frozen membership.
  `MARIANA_TEK_MODE=real` is set in `.env`; flip back to `mock` to iterate
  against safe seeded data instead.
- **Rules playbook** (`src/rules/playbook.ts`): the 3 confirmed paths ($39
  1-week trial, $99 1-month trial/Comeback/ClassPass-purchase, ClassPass
  guest booking) are real, with a 3-touch conversion-oriented cadence
  (welcome -> mid-trial pricing nudge -> final push). Class-pack-low,
  lapsed-member, and generic-walk-in rules are still **placeholder** —
  haven't been reviewed against the real playbook.
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
- **Recap delivery**: printed as a markdown table in chat (and saved to
  `data/recaps/`) for Lucas to review. Once he approves an item, `npm run
  send -- <touchId>` dispatches that one message through HighLevel — never
  automatic, always one explicit approval per send.

## How it works

1. `npm run assess` pulls class sessions from Mariana Tek for the last
   `ASSESS_LOOKBACK_DAYS` (default 14) that haven't been processed yet
   (tracked in `data/store.json`). In real mode, Mariana Tek's date filters
   don't work (see `realClient.ts`), so this walks pages of class sessions
   plus one roster/client/membership lookup per attendee — cheap for a
   short window, but a 14-day first run against a real location could be a
   few hundred requests. Start with a short `ASSESS_LOOKBACK_DAYS` (e.g. 1)
   for a first real run.
2. For each attendee, fetches their membership status and runs it through
   `PLAYBOOK` (`src/rules/playbook.ts`) — first matching rule wins.
3. Checks `data/store.json`'s touch log so the same client isn't re-proposed
   the same segment within that rule's cooldown window.
4. Prints/saves a recap listing every attendee, their status, and the
   proposed action (or why none/nothing new was proposed).
5. Marks the class as processed and logs any proposed touches (including
   the drafted message and recipient contact info).
6. Once Lucas approves an item, `npm run send -- <touchId>` upserts the
   contact in HighLevel and sends that one email/text.

## Setup

```bash
npm install
cp .env.example .env   # fill in as integrations go live; mock mode needs no changes
npm run assess
```

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

The touch log (`data/store.json`) is more than a dedup/cooldown mechanism —
it's the record the "keep what works, adapt what doesn't" loop runs on:

1. Every proposed action from `npm run assess` is logged with `status:
   'proposed'`.
2. As Lucas approves/edits/rejects items from a recap (in chat, for now),
   run `npm run outcome -- <touchId> <approved|edited|rejected|sent>` to
   record it. Once messages are actually sent and we can tell if someone
   converted, `converted` closes the loop.
3. `npm run stats` reports approval rate per segment (`trial_1week_convert`,
   `classpass_guest_pitch`, etc.) — a segment that's consistently rejected or
   edited the same way is a signal to rewrite it in `src/rules/playbook.ts`;
   one that converts well is a pattern to reuse elsewhere.

This is manual/assisted for now (I read Lucas's decisions and record them) —
automating the recap-reply -> outcome pipeline is a later step, but the data
model is already there.

## Next steps

- Get real trigger/copy details for class-pack-low, lapsed-member, and
  generic-walk-in segments to replace their placeholders in
  `src/rules/playbook.ts`.
- Find the real class-pack/credit resource in Mariana Tek's API (not yet
  located — `getMembershipStatus` never returns `class_pack` against real
  data today) and confirm `membership_paused`'s real shape.
- Run a real `npm run assess` with a short lookback window as the first
  live end-to-end test — not done yet, since it surfaces real client PII
  into the recap.
- Phase 2: Mariana Tek write access to process approved membership sales
  directly (currently out of scope — sales still need to be entered in
  Mariana Tek manually even after a client agrees).
- Phase 3: feed real conversion outcomes back through `npm run outcome` and
  start actually rewriting playbook rules based on `npm run stats`.
