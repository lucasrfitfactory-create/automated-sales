import { CLASSPASS_ONE_MONTH_PRICE, formatClassPackTeaser, formatWeeklyUnlimitedPricing } from './pricing.js';
import type { ProposedAction, Rule } from './types.js';

// ============================================================================
// Fit Factory sales playbook.
//
// Confirmed paths (from Lucas, 2026-08-25):
//   1. $39 trial — 1 week unlimited        -> convert to Weekly Unlimited membership
//   2. $99 trial — 1 month unlimited,
//      "Comeback Offer", or ClassPass       -> convert to Weekly Unlimited membership
//      1-month-unlimited purchase (same
//      treatment, different entry point)
//   3. ClassPass guest booking               -> convert to Weekly Unlimited membership,
//      ("Guest of ClassPass", no direct         with the $99 ClassPass 1-month-unlimited
//      Fit Factory purchase on file)            pass as an easier ask, and class packages
//                                                as a fallback if they don't want a membership
//
// STILL PLACEHOLDER / not yet confirmed by Lucas: class-pack-running-low,
// lapsed-membership win-back, and generic-walk-in-with-nothing-on-file. Kept
// from the earlier draft so the pipeline still covers those cases, but the
// triggers/timing/copy need review. Also placeholder: exact class-pack price
// points (asked Lucas — couldn't scrape the live pricing widget).
//
// Cadence (2026-08-25, "should be conversion-oriented, keep what works,
// adapt what doesn't"): three touches per trial instead of two — a light
// welcome, a mid-trial nudge that puts membership pricing in front of them
// early (not just at the very end), and a final urgency push. Email carries
// the actual pricing pitch (more room, feels less naggy); text is reserved
// for the light-touch welcome. This is a first cut, not yet outcome-tuned —
// see README's "Learning loop" section for how we adjust it from here.
// ============================================================================

const WEEKLY_UNLIMITED_PRICING = formatWeeklyUnlimitedPricing();

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

function isWeekTrial(offerName: string): boolean {
  return /1[\s-]*week/i.test(offerName);
}

function isComeback(offerName: string): boolean {
  return /comeback/i.test(offerName);
}

export const PLAYBOOK: Rule[] = [
  // Path 1: $39 trial, 1 week unlimited. Three touches: welcome -> mid-trial pricing tease -> final push.
  (ctx) => {
    if (ctx.status.kind !== 'trial_offer' || !isWeekTrial(ctx.status.offerName)) return null;
    const daysLeft = daysBetween(new Date(ctx.status.endDate), ctx.now);
    const daysElapsed = daysBetween(ctx.now, new Date(ctx.status.startDate));

    if (daysLeft <= 2) {
      const action: ProposedAction = {
        segmentKey: 'trial_1week_convert',
        segmentLabel: `${ctx.status.offerName} — ${daysLeft}d left`,
        channel: 'email',
        headline: 'Final push to convert before $39 trial ends',
        message: `Hey ${ctx.client.firstName} — your week of unlimited classes wraps up soon! Loved having you in. Want to keep it going on a Weekly Unlimited membership? We've got ${WEEKLY_UNLIMITED_PRICING} depending on commitment length — happy to set you up with whichever fits best, today if you want to lock in your spot.`,
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
        message: `Hi ${ctx.client.firstName}! Great first class 🙌 You've got unlimited classes this week (plus a guest pass to bring a friend) — come try a few different formats and let us know if you have any questions!`,
        cooldownDays: 7,
      };
      return action;
    }
    const action: ProposedAction = {
      segmentKey: 'trial_1week_midtrial',
      segmentLabel: `${ctx.status.offerName} — mid-trial`,
      channel: 'email',
      headline: 'Mid-trial nudge — put membership pricing in front of them early',
      message: `Hey ${ctx.client.firstName} — hope you're loving the classes so far! A few of our regulars started exactly where you are. If you want to keep this going after your trial week, Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment — happy to answer any questions before your trial wraps up.`,
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

    if (daysLeft <= 3) {
      const action: ProposedAction = {
        segmentKey: 'trial_1month_convert',
        segmentLabel: `${ctx.status.offerName} — ${daysLeft}d left`,
        channel: 'email',
        headline: 'Final push to convert before 1-month unlimited trial ends',
        message: `Hey ${ctx.client.firstName} — ${comeback ? "so glad you've been back in class! " : ''}your month of unlimited classes wraps up soon. Want to lock in a Weekly Unlimited membership so you keep the momentum? We've got ${WEEKLY_UNLIMITED_PRICING} depending on commitment length — happy to set you up today.`,
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
          ? `Hey ${ctx.client.firstName}, so good to see you back at the studio! Let us know if you need anything as you get back into it.`
          : `Hi ${ctx.client.firstName}! Great first class 🙌 You've got a full month of unlimited classes — let us know if you have any questions as you explore the schedule.`,
        cooldownDays: 10,
      };
      return action;
    }
    const action: ProposedAction = {
      segmentKey: 'trial_1month_midtrial',
      segmentLabel: `${ctx.status.offerName} — mid-trial`,
      channel: 'email',
      headline: 'Mid-trial nudge — put membership pricing in front of them early',
      message: `Hey ${ctx.client.firstName} — hope the month's been going well! If you want to keep the momentum going past your trial, Weekly Unlimited runs ${WEEKLY_UNLIMITED_PRICING} depending on commitment — happy to walk you through it whenever's convenient, no rush.`,
      cooldownDays: 10,
    };
    return action;
  },

  // Path 3: ClassPass guest, nothing purchased directly with Fit Factory yet.
  (ctx) => {
    if (ctx.rosterEntry.bookingSource !== 'classpass') return null;
    if (ctx.status.kind !== 'no_active_status') return null; // already has a direct FF status — let that rule handle it
    const action: ProposedAction = {
      segmentKey: 'classpass_guest_pitch',
      segmentLabel: 'ClassPass guest — no direct Fit Factory purchase',
      channel: 'email',
      headline: 'ClassPass guest — pitch membership, fallback to $99 pass or packages',
      message: `Hey ${ctx.client.firstName}, thanks for coming in through ClassPass! If you want to make Fit Factory a regular thing, a Weekly Unlimited membership is the best value (${WEEKLY_UNLIMITED_PRICING}). If you'd rather ease in, we've also got a $${CLASSPASS_ONE_MONTH_PRICE} one-month unlimited pass, or ${formatClassPackTeaser()} if a membership isn't the right fit yet. Happy to walk you through options.`,
      cooldownDays: 7,
    };
    return action;
  },

  // PLACEHOLDER — class pack running low or expired.
  (ctx) => {
    if (ctx.status.kind !== 'class_pack') return null;
    if (ctx.status.classesRemaining > 1) return null;
    const expired = ctx.status.classesRemaining <= 0;
    const action: ProposedAction = {
      segmentKey: expired ? 'class_pack_expired' : 'class_pack_low',
      segmentLabel: expired
        ? `${ctx.status.packName} — used up`
        : `${ctx.status.packName} — ${ctx.status.classesRemaining} left`,
      channel: 'email',
      headline: expired ? 'Class pack used up — re-engage' : 'Class pack almost out — upsell',
      message: expired
        ? `Hey ${ctx.client.firstName} — looks like your ${ctx.status.packName} is all used up! Want to grab another one (${formatClassPackTeaser()}), or is it time to talk about a Weekly Unlimited membership (${WEEKLY_UNLIMITED_PRICING}) so you're not thinking about it each time?`
        : `Hey ${ctx.client.firstName} — you're down to your last class on your ${ctx.status.packName}. Want me to set you up with another one (${formatClassPackTeaser()}), or would a Weekly Unlimited membership make more sense at this point?`,
      cooldownDays: 5,
    };
    return action;
  },

  // PLACEHOLDER — lapsed membership win-back.
  (ctx) => {
    if (ctx.status.kind !== 'membership_lapsed') return null;
    const action: ProposedAction = {
      segmentKey: 'membership_lapsed_winback',
      segmentLabel: `Lapsed member (${ctx.status.planName}, ended ${ctx.status.endedAt.slice(0, 10)})`,
      channel: 'text',
      headline: 'Lapsed member showed up — win-back',
      message: `Hey ${ctx.client.firstName}, so good to see you back in class! Want to talk about getting your membership going again? We can make it easy.`,
      cooldownDays: 14,
    };
    return action;
  },

  // PLACEHOLDER — walk-in/drop-in with nothing on file and not a ClassPass guest.
  (ctx) => {
    if (ctx.status.kind !== 'no_active_status') return null;
    if (ctx.rosterEntry.bookingSource === 'classpass') return null; // handled above
    const action: ProposedAction = {
      segmentKey: 'no_status_intro_pitch',
      segmentLabel: 'No active offer/membership/pack on file',
      channel: 'email',
      headline: 'Drop-in with nothing on file — pitch trial offer',
      message: `Hey ${ctx.client.firstName}, thanks for dropping into class! If you want to try a few more, we've got a $39 one-week unlimited trial that's a great way to explore the studio. Want the details?`,
      cooldownDays: 10,
    };
    return action;
  },

  // membership_active, membership_paused -> no rule matches -> no proposed action (intentional no-op).
];
