import type { ProposedAction, Rule, RuleContext } from './types.js';

/** First matching rule wins. Returns null if no rule applies (e.g. active membership — no action needed). */
export function evaluate(ctx: RuleContext, rules: Rule[]): ProposedAction | null {
  for (const rule of rules) {
    const action = rule(ctx);
    if (action) return action;
  }
  return null;
}
