// Source of truth for pricing copy used in drafted messages. Pulled from the
// live public pricing page (fitfactoryfitness.com/pricing/downtown,
// confirmed 2026-08-25) — NOT from Mariana Tek yet (no API access). Update
// here once Mariana Tek is wired in so this always reflects what's actually
// for sale, and revisit the flash-sale class packs after 2026-08-31 (offer
// end date printed on the site).

export interface WeeklyUnlimitedTier {
  commitment: string;
  pricePerWeek: number;
  note: string;
}

// NOTE: Lucas said 3-month was $59/week same as 6-month; the live site
// shows $69/week for 3-month. Using the live site's number below — confirm
// with Lucas which is correct before this goes out for real.
export const WEEKLY_UNLIMITED_TIERS: WeeklyUnlimitedTier[] = [
  { commitment: '12-month', pricePerWeek: 49, note: 'best value' },
  { commitment: '6-month', pricePerWeek: 59, note: 'includes a free guest pass' },
  { commitment: '3-month', pricePerWeek: 69, note: 'most flexible' },
];

export function formatWeeklyUnlimitedPricing(): string {
  return WEEKLY_UNLIMITED_TIERS.map((t) => `$${t.pricePerWeek}/week (${t.commitment})`).join(', ');
}

export interface ClassPack {
  name: string;
  price: number;
  classes: number;
  validity: string;
}

export const CLASS_PACKS: ClassPack[] = [
  { name: '5 Class Pack', price: 159, classes: 5, validity: '6 months' },
  { name: '10 Class Pack (flash sale through Aug 31)', price: 199, classes: 10, validity: '6 months' },
  { name: '20 Class Pack (flash sale through Aug 31)', price: 349, classes: 20, validity: '6 months' },
  { name: '40 Class Pack', price: 999, classes: 40, validity: '6 months' },
];

export function formatClassPackOptions(): string {
  return CLASS_PACKS.map((p) => `${p.name} — $${p.price} (${p.classes} classes)`).join(', ');
}

/** Short, conversational mention for drafted messages — full breakdown belongs in a follow-up, not the first text. */
export function formatClassPackTeaser(): string {
  const cheapest = CLASS_PACKS[0]!;
  return `class packs starting at $${cheapest.price} (${cheapest.classes} classes)`;
}

export const CLASSPASS_ONE_MONTH_PRICE = 99;
