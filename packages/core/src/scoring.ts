export const PHASES = ["emerging", "rising", "peak", "saturated", "declining"] as const;
export type Phase = (typeof PHASES)[number];

export const SIGNALS = ["store", "ads", "social", "tiktokshop", "marketplace", "search", "reddit", "price"] as const;
export type SignalId = (typeof SIGNALS)[number];

export interface SignalBreakdown {
  signal: SignalId;
  group: "supply" | "demand" | "transactions" | "economics";
  latest: number;
  growth_1d: number;
  growth_7d: number;
  growth_30d: number;
  normalized: number;
  weight: number;
  contribution: number;
  share: number;
  positive: boolean;
  reliability: number;
}

export interface ScoreBreakdown {
  signals: SignalBreakdown[];
  positive_signals: number;
  positive_groups: string[];
  notes: ("convergence_bonus" | "concentration_penalty" | "gate_min_signals")[];
  supply: { stores: number; advertisers: number };
  demand_growth_7d: number;
  margin: number | null;
  margin_factor: number;
}

/** Marge per stuk na inkoop, verzending, transactiekosten en geschatte CPA. */
export function unitEconomics(input: {
  salePrice: number;
  productCost: number;
  shippingCost: number;
  feePct?: number; // betaalprovider + platform, standaard 3,5%
  cpa?: number;
}) {
  const fees = input.salePrice * (input.feePct ?? 0.035);
  const cogs = input.productCost + input.shippingCost;
  const grossProfit = input.salePrice - cogs - fees;
  const netProfit = grossProfit - (input.cpa ?? 0);
  return {
    fees,
    cogs,
    grossProfit,
    netProfit,
    grossMargin: input.salePrice > 0 ? grossProfit / input.salePrice : 0,
    netMargin: input.salePrice > 0 ? netProfit / input.salePrice : 0,
    breakEvenRoas: grossProfit > 0 ? input.salePrice / grossProfit : Infinity,
  };
}
