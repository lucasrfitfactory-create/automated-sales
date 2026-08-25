# Fit Factory — Automated Sales Agent

Reads class rosters from Mariana Tek, checks each attendee's membership/pack/
intro-offer status, and proposes a follow-up action (email or text) based on
a rules playbook. v1 only drafts and recaps — it does not send messages or
touch Mariana Tek/HighLevel yet. You review the recap and approve manually.

## Status

- **Mariana Tek**: API access requested, pending approval. Runs against
  seeded mock data (`MARIANA_TEK_MODE=mock`, the default) until the real key
  arrives — flip to `real` in `.env` once we have it. `src/marianaTek/realClient.ts`
  is a best-effort stub against the public Admin API overview and will need
  fixing against the actual reference once it's delivered with the key.
- **Rules playbook** (`src/rules/playbook.ts`): the 3 confirmed paths ($39
  1-week trial, $99 1-month trial/Comeback/ClassPass-purchase, ClassPass
  guest booking) are real, with a 3-touch conversion-oriented cadence
  (welcome -> mid-trial pricing nudge -> final push). Class-pack-low,
  lapsed-member, and generic-walk-in rules are still **placeholder** —
  haven't been reviewed against the real playbook.
- **Pricing** (`src/rules/pricing.ts`): pulled from the live pricing page
  2026-08-25. Open question: Lucas said the 3-month Weekly Unlimited tier
  was $59/week; the live site shows $69/week (6-month is the one at $59).
  Using the site's number until confirmed.
- **HighLevel**: not wired in yet — not needed until we're sending/executing
  approved actions (phase 2).
- **Recap delivery**: printed as a markdown table in chat (and saved to
  `data/recaps/`) for Lucas to review. Sending is a manual step for now.

## How it works

1. `npm run assess` pulls class sessions from Mariana Tek for the last
   `ASSESS_LOOKBACK_DAYS` (default 14) that haven't been processed yet
   (tracked in `data/store.json`).
2. For each attendee, fetches their membership status and runs it through
   `PLAYBOOK` (`src/rules/playbook.ts`) — first matching rule wins.
3. Checks `data/store.json`'s touch log so the same client isn't re-proposed
   the same segment within that rule's cooldown window.
4. Prints/saves a recap listing every attendee, their status, and the
   proposed action (or why none/nothing new was proposed).
5. Marks the class as processed and logs any proposed touches.

## Setup

```bash
npm install
cp .env.example .env   # fill in as integrations go live; mock mode needs no changes
npm run assess
```

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

- Confirm the 3-month Weekly Unlimited price ($59 vs $69/week) and get real
  trigger/copy details for class-pack-low, lapsed-member, and generic-walk-in
  segments to replace their placeholders in `src/rules/playbook.ts`.
- Once Mariana Tek API access is approved: fill in `MARIANA_TEK_API_URL`/
  `MARIANA_TEK_API_KEY`, verify `src/marianaTek/realClient.ts` against the
  real Admin API reference (especially `getMembershipStatus`, which needs
  the purchases/packages/memberships resource shape, and how "Guest of
  ClassPass" actually shows up on a roster/reservation).
- Wire up Outlook sending directly (vs. manual) once the recap format is
  validated.
- Phase 2: HighLevel integration to actually send approved messages, and
  Mariana Tek write access to process approved membership sales.
- Phase 3: feed real conversion outcomes back through `npm run outcome` and
  start actually rewriting playbook rules based on `npm run stats`.
