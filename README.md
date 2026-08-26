# Fit Factory — Automated Sales Agent

Reads class rosters from Mariana Tek, checks each attendee's membership/pack/
intro-offer status, and proposes a follow-up action (email or text) based on
a rules playbook. Nothing sends on its own — Lucas reviews the recap in chat
and approves items one at a time; only then does `npm run send` dispatch
that specific message through HighLevel.

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
- **Rules playbook** (`src/rules/playbook.ts`): the 3 confirmed paths ($39
  1-week trial, $99 1-month trial/Comeback/ClassPass-purchase, ClassPass
  guest booking) are real. Cadence rebuilt 2026-08-26 as **text-first**:
  every sales touch is a short single-product text, with an automatic
  email follow-up if there's no reply within `followUp.afterDays` (2 days
  default, 1 day for urgent "trial ends in ≤2/3 days" touches) — see
  "Learning loop" below for how the follow-up actually gets sent. Copy
  rules, confirmed the hard way after two rounds of real feedback: exactly
  one product per message (no "or", not even framed as a choice), always
  ends on a direct close ("Want me to set that up for you?"), never a
  savings claim unless the math actually holds. A live Class Pack Sale
  (20 classes/$349, ends Aug 31) is pushed as that one product to
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
- **Recap delivery**: printed as a markdown table in chat (and saved to
  `data/recaps/`) for Lucas to review. Once he approves an item, `npm run
  send -- <touchId>` dispatches that one message through HighLevel — never
  automatic, always one explicit approval per send.

## How it works

1. `npm run assess` pulls class sessions from Mariana Tek for the configured
   window — either `ASSESS_LOOKBACK_DAYS` (default 14, rolling window ending
   now) or an explicit `ASSESS_SINCE`/`ASSESS_BEFORE` ISO range (for
   targeting a specific calendar day, e.g. "yesterday") — filtered to
   'Group Fitness' classroom only, that haven't been processed yet (tracked
   in `data/store.json`). In real mode, Mariana Tek's date filters don't
   work (see `realClient.ts`), so this walks pages of class sessions plus
   one roster/client/membership lookup per attendee — cheap for a short
   window, but a 14-day first run against a real location could be a few
   hundred requests. Start with a short window for a first real run.
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
   approval flow as anything from `npm run assess`. Verified idempotent —
   never queued twice for the same original touch.

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
