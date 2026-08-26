import { formatWeeklyUnlimitedPricing, formatClassPackSalePitch, isClassPackSaleActive, CLASS_PACKS } from './pricing.js';
import type { FollowUp, ProposedAction, Rule } from './types.js';

// ============================================================================
// Fit Factory sales playbook.
//
// Confirmed paths (from Lucas, 2026-08-25):
//   1. $39 trial — 1 week unlimited        -> convert to Weekly Unlimited membership
//   2. $99 trial — 1 month unlimited,
//      "Comeback Offer", or ClassPass       -> convert to Weekly Unlimited membership
//      1-month-unlimited purchase (same
//      treatment, different entry point)
//   3. ClassPass guest booking               -> convert to Weekly Unlimited membership
//      ("Guest of ClassPass", no direct
//      Fit Factory purchase on file)
//
// STILL PLACEHOLDER / not yet confirmed by Lucas: class-pack-running-low,
// genuine lapsed-real-membership win-back (as opposed to the now-confirmed
// expired-trial case below), and generic-walk-in-with-nothing-on-file.
// Triggers/timing are a first cut; how stale a lapsed membership can be
// before it's not worth a win-back is still an open question (a real test
// run surfaced one 16 months lapsed).
//
// Confirmed with Lucas 2026-08-26, from real test runs against live data:
//   - Only 'Group Fitness' classroom classes are in scope — PSC and Refined
//     Reformer are excluded at the source (see marianaTek/realClient.ts).
//   - Expired trials should still get a win-back message, but NOT if
//     they've already converted (a real active membership always takes
//     priority — see realClient.ts's getMembershipStatus).
//   - ClassPass guest detection (reservation tag "ClassPass Reservation")
//     confirmed correct against a real booking.
//
// CADENCE — rebuilt 2026-08-26 after reviewing a real batch of drafts:
//   Every sales touch is now TWO STEPS, not one:
//     1. An initial TEXT — short, single product, direct close.
//     2. An EMAIL FOLLOW-UP, sent only if there's no reply within
//        `followUp.afterDays` (2 days by default) — same single product,
//        with the pricing/link detail a text doesn't have room for.
//   `npm run check-replies` is what surfaces both new replies AND due
//   follow-ups each time it's run — see its file for how the follow-up
//   actually gets sent. Day-1 welcome texts don't get a follow-up (they're
//   not a sales ask).
//
// COPY RULES — confirmed with Lucas 2026-08-26, apply to every message:
//   1. Exactly ONE product per message. No "or" between two options, ever
//      — not even framed as "whichever makes sense for you." A second
//      Class Pack Sale push made this mistake (sale OR membership) and got
//      flagged as still too confusing. Pick one.
//   2. Always end on a direct, concrete close ("Want me to set that up for
//      you?") — never a soft "happy to help whenever, no rush."
//   3. Never state a savings/cost comparison unless the math actually holds
//      at that attendance level (caught a real bug: 3 classes/month on
//      Weekly Unlimited is ~$70/class, nowhere near "cheaper than
//      ClassPass"). Convenience/simplicity framing is used instead where
//      the exact math isn't confirmed.
// ============================================================================

const WEEKLY_UNLIMITED_PRICING = formatWeeklyUnlimitedPricing();
const CHEAPEST_PACK = CLASS_PACKS[0]!;

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function isWeekTrial(offerName: string): boolean {
  return /1[\s-]*week/i.test(offerName);
}

function isComeback(offerName: string): boolean {
  return /comeback/i.test(offerName);
}

const FREQUENT_THRESHOLD = 3; // classes in the last 30 days — "coming a lot" per Lucas, 2026-08-26. Drives a direct membership pitch, NOT a savings claim (see COPY RULES above).

/** Standard email follow-up wrapper — same single product as the text, restated with room for detail, sent only if the text gets no reply. */
function followUp(firstName: string, detail: string, afterDays = 2): FollowUp {
  return {
    channel: 'email',
    headline: 'Follow-up — no reply to the text',
    message: `Hey ${firstName}, following up on my text! ${detail} Want me to set that up for you?`,
    afterDays,
  };
}

export const PLAYBOOK: Rule[] = [
  // Path 0: ClassPass rebooker — bought a Fit Factory trial before, it
  // expired without converting, and they're back booking through ClassPass.
  // Must come before Path 2 (which would otherwise catch this via its own
  // daysLeft<0 branch with generic copy).
  (ctx) => {
    if (ctx.rosterEntry.bookingSource !== 'classpass') return null;
    if (ctx.status.kind !== 'trial_offer') return null;
    const daysLeft = daysBetween(new Date(ctx.status.endDate), ctx.now);
    if (daysLeft >= 0) return null; // trial still technically running — let Path 1/2 handle it normally
    const frequent = ctx.attendanceLast30Days >= FREQUENT_THRESHOLD;
    const saleOn = isClassPackSaleActive(ctx.now);
    const name = ctx.client.firstName;

    const message = saleOn
      ? `Hey ${name} — saw you're back on ClassPass after your trial wrapped up. We've got a Class Pack Sale on right now, but it ends August 31 — want me to set you up?`
      : frequent
        ? `Hey ${name} — you're in here a lot! Want me to get you set up on a Weekly Unlimited membership?`
        : `Hey ${name} — welcome back! Whenever you're ready to make Fit Factory official, want me to set you up on a membership?`;
    const detail = saleOn
      ? `We've got ${formatClassPackSalePitch()}.`
      : `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`;

    const action: ProposedAction = {
      segmentKey: 'classpass_rebook_after_trial',
      segmentLabel: `Back on ClassPass after ${ctx.status.offerName} expired ${-daysLeft}d ago${frequent ? ` (${ctx.attendanceLast30Days}x last 30d)` : ''}${saleOn ? ' [sale push]' : ''}`,
      channel: 'text',
      headline: 'ClassPass rebooker post-trial — text first',
      message,
      followUp: followUp(name, detail),
      cooldownDays: 14,
    };
    return action;
  },

  // Path 1: $39 trial, 1 week unlimited.
  (ctx) => {
    if (ctx.status.kind !== 'trial_offer' || !isWeekTrial(ctx.status.offerName)) return null;
    const daysLeft = daysBetween(new Date(ctx.status.endDate), ctx.now);
    const daysElapsed = daysBetween(ctx.now, new Date(ctx.status.startDate));
    const name = ctx.client.firstName;

    if (daysLeft < 0) {
      const action: ProposedAction = {
        segmentKey: 'trial_1week_expired',
        segmentLabel: `${ctx.status.offerName} — expired ${-daysLeft}d ago, no conversion`,
        channel: 'text',
        headline: 'Trial expired without converting — text first',
        message: `Hey ${name} — your one-week trial wrapped up a bit ago. Still want to keep training with us? Want me to set you up on a membership?`,
        followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`),
        cooldownDays: 14,
      };
      return action;
    }
    if (daysLeft <= 2) {
      const action: ProposedAction = {
        segmentKey: 'trial_1week_convert',
        segmentLabel: `${ctx.status.offerName} — ${daysLeft}d left`,
        channel: 'text',
        headline: 'Final push to convert before $39 trial ends — text first',
        message: `Hey ${name} — your trial wraps up in ${daysLeft}d! Want me to lock you in on a membership before it ends?`,
        followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`, 1),
        cooldownDays: 3,
      };
      return action;
    }
    if (daysElapsed <= 1) {
      const action: ProposedAction = {
        segmentKey: 'trial_1week_welcome',
        segmentLabel: `${ctx.status.offerName} — welcome`,
        channel: 'text',
        headline: 'Welcome $39 week-trial client',
        message: `Hi ${name}! Great first class 🙌 You've got unlimited classes this week (plus a guest pass to bring a friend) — come try a few different formats and let us know if you have any questions!`,
        cooldownDays: 7,
      };
      return action;
    }
    const action: ProposedAction = {
      segmentKey: 'trial_1week_midtrial',
      segmentLabel: `${ctx.status.offerName} — mid-trial`,
      channel: 'text',
      headline: 'Mid-trial nudge — text first',
      message: `Hey ${name} — hope you're loving the classes so far! Want me to set you up on a membership so you can keep this going after your trial?`,
      followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`),
      cooldownDays: 4,
    };
    return action;
  },

  // Path 2: $99 trial (1 month), Comeback Offer, or ClassPass 1-month-unlimited purchase — same treatment.
  (ctx) => {
    if (ctx.status.kind !== 'trial_offer' || isWeekTrial(ctx.status.offerName)) return null;
    const daysLeft = daysBetween(new Date(ctx.status.endDate), ctx.now);
    const daysElapsed = daysBetween(ctx.now, new Date(ctx.status.startDate));
    const comeback = isComeback(ctx.status.offerName);
    const name = ctx.client.firstName;

    if (daysLeft < 0) {
      const action: ProposedAction = {
        segmentKey: 'trial_1month_expired',
        segmentLabel: `${ctx.status.offerName} — expired ${-daysLeft}d ago, no conversion`,
        channel: 'text',
        headline: 'Trial expired without converting — text first',
        message: `Hey ${name} — ${comeback ? 'good having you back for a bit! ' : ''}your trial wrapped up a bit ago. Still want to keep it going? Want me to set you up on a membership?`,
        followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`),
        cooldownDays: 14,
      };
      return action;
    }
    if (daysLeft <= 3) {
      const action: ProposedAction = {
        segmentKey: 'trial_1month_convert',
        segmentLabel: `${ctx.status.offerName} — ${daysLeft}d left`,
        channel: 'text',
        headline: 'Final push to convert before 1-month trial ends — text first',
        message: `Hey ${name} — your trial wraps up in ${daysLeft}d! Want me to lock you in on a membership before it ends?`,
        followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`, 1),
        cooldownDays: 3,
      };
      return action;
    }
    if (daysElapsed <= 1) {
      const action: ProposedAction = {
        segmentKey: 'trial_1month_welcome',
        segmentLabel: `${ctx.status.offerName} — welcome`,
        channel: 'text',
        headline: comeback ? 'Welcome back — comeback offer' : 'Welcome $99 month-trial client',
        message: comeback
          ? `Hey ${name}, so good to see you back at the studio! Let us know if you need anything as you get back into it.`
          : `Hi ${name}! Great first class 🙌 You've got a full month of unlimited classes — let us know if you have any questions as you explore the schedule.`,
        cooldownDays: 10,
      };
      return action;
    }
    const action: ProposedAction = {
      segmentKey: 'trial_1month_midtrial',
      segmentLabel: `${ctx.status.offerName} — mid-trial`,
      channel: 'text',
      headline: 'Mid-trial nudge — text first',
      message: `Hey ${name} — hope the month's been going well! Want me to set you up on a membership to keep this going?`,
      followUp: followUp(name, `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`),
      cooldownDays: 10,
    };
    return action;
  },

  // Path 3: ClassPass guest, nothing purchased directly with Fit Factory yet.
  (ctx) => {
    if (ctx.rosterEntry.bookingSource !== 'classpass') return null;
    if (ctx.status.kind !== 'no_active_status') return null; // already has a direct FF status — let that rule handle it
    const frequent = ctx.attendanceLast30Days >= FREQUENT_THRESHOLD;
    const saleOn = isClassPackSaleActive(ctx.now);
    const name = ctx.client.firstName;

    const message = saleOn
      ? `Hey ${name}, thanks for coming in through ClassPass! We've got a Class Pack Sale on right now, but it ends August 31 — want me to set you up?`
      : frequent
        ? `Hey ${name} — you've been coming in a lot through ClassPass! Want me to set you up on a Weekly Unlimited membership instead?`
        : `Hey ${name}, thanks for coming in through ClassPass! Want me to set you up on a Weekly Unlimited membership?`;
    const detail = saleOn ? `We've got ${formatClassPackSalePitch()}.` : `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`;

    const action: ProposedAction = {
      segmentKey: 'classpass_guest_pitch',
      segmentLabel: `ClassPass guest — no direct Fit Factory purchase${frequent ? ` (${ctx.attendanceLast30Days}x last 30d)` : ''}${saleOn ? ' [sale push]' : ''}`,
      channel: 'text',
      headline: 'ClassPass guest — text first',
      message,
      followUp: followUp(name, detail),
      cooldownDays: 7,
    };
    return action;
  },

  // PLACEHOLDER — class pack running low OR expiring soon (by date, even
  // with classes still left — those unused credits are about to be lost).
  (ctx) => {
    if (ctx.status.kind !== 'class_pack') return null;
    const daysUntilExpiry = ctx.status.expiresAt ? daysBetween(new Date(ctx.status.expiresAt), ctx.now) : null;
    const usedUp = ctx.status.classesRemaining <= 0;
    const runningLow = !usedUp && ctx.status.classesRemaining <= 1;
    const expiringSoon = !usedUp && daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 14;
    if (!usedUp && !runningLow && !expiringSoon) return null;

    const saleOn = isClassPackSaleActive(ctx.now);
    const name = ctx.client.firstName;
    const situation = usedUp
      ? `your ${ctx.status.packName} is all used up`
      : expiringSoon
        ? `your ${ctx.status.packName} expires in ${daysUntilExpiry}d with ${ctx.status.classesRemaining} class${ctx.status.classesRemaining === 1 ? '' : 'es'} still on it`
        : `you're down to your last class on your ${ctx.status.packName}`;

    const message = saleOn
      ? `Hey ${name} — ${situation}. We've got a Class Pack Sale on right now, but it ends August 31 — want me to set you up?`
      : `Hey ${name} — ${situation}. Want me to set you up with another pack?`;
    const detail = saleOn
      ? `We've got ${formatClassPackSalePitch()}.`
      : `A ${CHEAPEST_PACK.name} runs $${CHEAPEST_PACK.price} (${CHEAPEST_PACK.classes} classes).`;

    const action: ProposedAction = {
      segmentKey: usedUp ? 'class_pack_expired' : expiringSoon ? 'class_pack_expiring_soon' : 'class_pack_low',
      segmentLabel: `${ctx.status.packName} — ${usedUp ? 'used up' : expiringSoon ? `expires ${daysUntilExpiry}d, ${ctx.status.classesRemaining} left` : `${ctx.status.classesRemaining} left`}${saleOn ? ' [sale push]' : ''}`,
      channel: 'text',
      headline: expiringSoon ? 'Class pack expiring soon — text first' : usedUp ? 'Class pack used up — text first' : 'Class pack almost out — text first',
      message,
      followUp: followUp(name, detail),
      cooldownDays: 5,
    };
    return action;
  },

  // PLACEHOLDER — lapsed membership win-back.
  (ctx) => {
    if (ctx.status.kind !== 'membership_lapsed') return null;
    const name = ctx.client.firstName;
    const action: ProposedAction = {
      segmentKey: 'membership_lapsed_winback',
      segmentLabel: `Lapsed member (${ctx.status.planName}, ended ${ctx.status.endedAt.slice(0, 10)})`,
      channel: 'text',
      headline: 'Lapsed member showed up — text first',
      message: `Hey ${name}, so good to see you back in class! Want me to get your membership set back up?`,
      followUp: followUp(name, `Should be quick to set back up — same membership, no need to start over.`),
      cooldownDays: 14,
    };
    return action;
  },

  // PLACEHOLDER — walk-in/drop-in with nothing on file and not a ClassPass guest.
  (ctx) => {
    if (ctx.status.kind !== 'no_active_status') return null;
    if (ctx.rosterEntry.bookingSource === 'classpass') return null; // handled above
    const frequent = ctx.attendanceLast30Days >= FREQUENT_THRESHOLD;
    const name = ctx.client.firstName;
    const message = frequent
      ? `Hey ${name} — you've been in a lot lately without a membership! Want me to set you up on a Weekly Unlimited membership?`
      : `Hey ${name}, thanks for dropping into class! Want me to send you the link for our $39 one-week trial?`;
    const detail = frequent
      ? `Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment.`
      : `It's unlimited classes for one week, $39, a great way to try the studio.`;

    const action: ProposedAction = {
      segmentKey: frequent ? 'no_status_frequent_pitch_membership' : 'no_status_intro_pitch',
      segmentLabel: frequent
        ? `No membership/pack on file, but ${ctx.attendanceLast30Days}x in the last month`
        : 'No active offer/membership/pack on file',
      channel: 'text',
      headline: frequent ? 'Frequent drop-in, no membership — text first' : 'Drop-in with nothing on file — text first',
      message,
      followUp: followUp(name, detail),
      cooldownDays: frequent ? 7 : 10,
    };
    return action;
  },

  // membership_active, membership_paused -> no rule matches -> no proposed action (intentional no-op).
];
