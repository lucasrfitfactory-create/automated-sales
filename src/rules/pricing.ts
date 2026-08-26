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

// Confirmed with Lucas 2026-08-25: 12mo $49/wk, 6mo $59/wk, 3mo $69/wk.
export const WEEKLY_UNLIMITED_TIERS: WeeklyUnlimitedTier[] = [
  { commitment: '12-month', pricePerWeek: 49, note: 'best value' },
  { commitment: '6-month', pricePerWeek: 59, note: 'includes a free guest pass' },
  { commitment: '3-month', pricePerWeek: 69, note: 'most flexible' },
];

export function formatWeeklyUnlimitedPricing(): string {
  return WEEKLY_UNLIMITED_TIERS.map((t) => `$${t.pricePerWeek}/week (${t.commitment})`).join(', ');
}

/** Short anchor for the initial text — the one number that makes it an easy yes, not the full tier breakdown. */
export function formatWeeklyUnlimitedCheapest(): string {
  const cheapest = [...WEEKLY_UNLIMITED_TIERS].sort((a, b) => a.pricePerWeek - b.pricePerWeek)[0]!;
  return `as low as $${cheapest.pricePerWeek}/week`;
}

export interface ClassPack {
  name: string;
  price: number;
  classes: number;
  validity: string;
}

export const CLASS_PACKS: ClassPack[] = [
  { name: '5 Class Pack', price: 159, classes: 5, validity: '6 months' },
  { name: '10 Class Pack (flash sale through Aug 31)', price: 199, classes: 10, validity: '3 months' },
  { name: '20 Class Pack (flash sale through Aug 31)', price: 349, classes: 20, validity: '3 months' },
  { name: '40 Class Pack', price: 999, classes: 40, validity: '6 months' },
];

// Class Pack Sale — confirmed with Lucas 2026-08-26 from the live site
// (fitfactoryfitness.com/class-pack-deal). Ends midnight Aug 31 Toronto
// time. isClassPackSaleActive() gates the promo copy in playbook.ts so it
// stops firing on its own after the deadline — no manual revert needed.
export const CLASS_PACK_SALE_URL = 'https://www.fitfactoryfitness.com/class-pack-deal';
export const CLASS_PACK_SALE_END_ISO = '2026-09-01T04:00:00Z'; // midnight Aug 31 EDT (UTC-4)
export const CLASS_PACK_SALE_20 = { price: 349, wasPrice: 549, classes: 20, perClass: 17.45 };
export const CLASS_PACK_SALE_10 = { price: 199, wasPrice: 299, classes: 10, perClass: 19.9 };

export function isClassPackSaleActive(now: Date): boolean {
  return now.toISOString() < CLASS_PACK_SALE_END_ISO;
}

/** The lead pitch for the active flash sale — 20-pack (best value), with urgency and the direct purchase link. */
export function formatClassPackSalePitch(): string {
  const s = CLASS_PACK_SALE_20;
  return `our Class Pack Sale: ${s.classes} classes for $${s.price} (was $${s.wasPrice}, just $${s.perClass}/class), no commitment, but it ends August 31: ${CLASS_PACK_SALE_URL}`;
}

/** Short anchor for the initial text — the headline savings number plus the link, so it's a one-click yes. Callers supply "Class Pack Sale" themselves so it isn't repeated. */
export function formatClassPackSaleTeaser(): string {
  const maxSavings = CLASS_PACK_SALE_20.wasPrice - CLASS_PACK_SALE_20.price;
  return `save up to $${maxSavings}, ends Aug 31: ${CLASS_PACK_SALE_URL}`;
}
