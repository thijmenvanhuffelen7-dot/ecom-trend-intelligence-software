export const PLAN_IDS = ["free", "starter", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Feature =
  | "searches_per_day"
  | "tracked_shops"
  | "alerts"
  | "exports_per_month"
  | "ai_assistant"
  | "api_access"
  | "leads_export"
  | "seats";

export interface Plan {
  id: PlanId;
  /** Hoeveel dagen historie de gebruiker mag zien (afgedwongen in de query-laag). */
  dataWindowDays: number;
  limits: Record<Feature, number>; // 0 = niet beschikbaar, Infinity = onbeperkt
  priceMonthlyEur: number;
  priceYearlyEur: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    dataWindowDays: 7,
    priceMonthlyEur: 0,
    priceYearlyEur: 0,
    limits: { searches_per_day: 10, tracked_shops: 0, alerts: 0, exports_per_month: 0, ai_assistant: 0, api_access: 0, leads_export: 0, seats: 1 },
  },
  starter: {
    id: "starter",
    dataWindowDays: 90,
    priceMonthlyEur: 49,
    priceYearlyEur: 470,
    limits: { searches_per_day: 200, tracked_shops: 5, alerts: 5, exports_per_month: 5, ai_assistant: 0, api_access: 0, leads_export: 0, seats: 1 },
  },
  pro: {
    id: "pro",
    dataWindowDays: 365,
    priceMonthlyEur: 99,
    priceYearlyEur: 950,
    limits: { searches_per_day: Infinity, tracked_shops: 50, alerts: 50, exports_per_month: 50, ai_assistant: 300, api_access: 0, leads_export: 0, seats: 3 },
  },
  business: {
    id: "business",
    dataWindowDays: 730,
    priceMonthlyEur: 299,
    priceYearlyEur: 2870,
    limits: { searches_per_day: Infinity, tracked_shops: 500, alerts: 500, exports_per_month: Infinity, ai_assistant: 2000, api_access: 100_000, leads_export: 20_000, seats: 15 },
  },
};

export class LimitExceededError extends Error {
  constructor(
    readonly feature: Feature,
    readonly limit: number,
    readonly plan: PlanId,
  ) {
    super(limit === 0 ? `"${feature}" is niet beschikbaar in het ${plan}-plan` : `Limiet voor "${feature}" bereikt (${limit})`);
  }
}

/** Gooit een LimitExceededError als `used + amount` boven de planlimiet uitkomt. */
export function assertWithinLimit(plan: PlanId, feature: Feature, used: number, amount = 1): void {
  const limit = PLANS[plan].limits[feature];
  if (used + amount > limit) throw new LimitExceededError(feature, limit, plan);
}

/** Vroegste datum die een plan mag zien. */
export function dataWindowStart(plan: PlanId, today: Date = new Date()): Date {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - PLANS[plan].dataWindowDays);
  return d;
}
