import type { ProposedAction, Rule } from './types.js';

// ============================================================================
// PLACEHOLDER PLAYBOOK — not yet reviewed by Lucas.
//
// These rules exist so the pipeline is exercisable end to end (mock data ->
// segment -> proposed action -> recap email). The exact triggers, channels,
// and message copy below are reasonable-guess defaults for a boutique
// fitness studio, NOT the real Fit Factory sales playbook. Replace/edit the
// rules below once we have the actual rules (trigger conditions, timing,
// message tone/offers).
// ============================================================================

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export const PLAYBOOK: Rule[] = [
  // Intro offer, fully used, offer ending within 2 days — highest urgency to convert.
  (ctx) => {
    if (ctx.status.kind !== 'intro_offer') return null;
    const daysLeft = daysBetween(new Date(ctx.status.endDate), ctx.now);
    const usedUp = ctx.status.classesUsed >= ctx.status.classesIncluded;
    if (!usedUp && daysLeft > 2) return null;
    const action: ProposedAction = {
      segmentKey: 'intro_offer_expiring',
      segmentLabel: `Intro offer (${ctx.status.offerName}) — ${usedUp ? 'used up' : `${daysLeft}d left`}`,
      channel: 'email',
      headline: `Convert intro offer before it lapses (${daysLeft}d left)`,
      message: `Hey ${ctx.client.firstName} — so glad you've been coming to class! Your ${ctx.status.offerName} wraps up soon. Want to lock in a membership so you don't lose momentum? Happy to walk you through pricing whenever works.`,
      cooldownDays: 3,
    };
    return action;
  },

  // Intro offer, early days — light-touch welcome, not a hard sell yet.
  (ctx) => {
    if (ctx.status.kind !== 'intro_offer') return null;
    const action: ProposedAction = {
      segmentKey: 'intro_offer_welcome',
      segmentLabel: `Intro offer (${ctx.status.offerName}) — welcome`,
      channel: 'text',
      headline: 'Welcome new intro-offer client',
      message: `Hi ${ctx.client.firstName}! Great first class today 🙌 Let us know if you have any questions as you try out more classes this week.`,
      cooldownDays: 7,
    };
    return action;
  },

  // Class pack running low.
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
        ? `Hey ${ctx.client.firstName} — looks like your ${ctx.status.packName} is all used up! Want to grab another pack, or is it time to talk about a membership so you're not thinking about it each time?`
        : `Hey ${ctx.client.firstName} — you're down to your last class on your ${ctx.status.packName}. Want me to set you up with a new pack, or would a membership make more sense at this point?`,
      cooldownDays: 5,
    };
    return action;
  },

  // Lapsed membership — win-back.
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

  // Walk-in / drop-in with no purchase on file at all — pitch the intro offer.
  (ctx) => {
    if (ctx.status.kind !== 'no_active_status') return null;
    const action: ProposedAction = {
      segmentKey: 'no_status_intro_pitch',
      segmentLabel: 'No active offer/membership/pack on file',
      channel: 'email',
      headline: 'Drop-in with nothing on file — pitch intro offer',
      message: `Hey ${ctx.client.firstName}, thanks for dropping into class! If you want to try a few more, we've got an intro offer that's a great way to explore the studio at a lower price point. Want the details?`,
      cooldownDays: 10,
    };
    return action;
  },

  // membership_active, membership_paused -> no rule matches -> no proposed action (intentional no-op).
];
