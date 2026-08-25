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
- **Rules playbook** (`src/rules/playbook.ts`): **placeholder**, not yet
  reviewed against Fit Factory's real sales process. Exists so the pipeline
  is exercisable end to end. Needs the real trigger conditions, timing, and
  message copy.
- **HighLevel**: not wired in yet — not needed until we're sending/executing
  approved actions (phase 2).
- **Recap delivery**: printed to stdout + saved to `data/recaps/`. Emailing
  it via Outlook is a manual step for now (done from the Claude Code session
  that ran `npm run assess`).

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

## Next steps

- Lucas to provide the real segmentation/playbook rules (trigger conditions
  per membership status, message tone/offers, cooldowns) to replace the
  placeholder in `src/rules/playbook.ts`.
- Once Mariana Tek API access is approved: fill in `MARIANA_TEK_API_URL`/
  `MARIANA_TEK_API_KEY`, verify `src/marianaTek/realClient.ts` against the
  real Admin API reference (especially `getMembershipStatus`, which needs
  the purchases/packages/memberships resource shape).
- Wire up Outlook sending directly (vs. manual) once the recap format is
  validated.
- Phase 2: HighLevel integration to actually send approved messages, and
  Mariana Tek write access to process approved membership sales.
- Phase 3: track outcomes (approved/rejected/converted) to start tuning the
  playbook — the "always learning" loop.
