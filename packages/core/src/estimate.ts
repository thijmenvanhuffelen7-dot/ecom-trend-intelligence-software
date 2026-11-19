import { z } from "zod";

/** Elk geschat cijfer (omzet, traffic, spend, GMV) reist met bandbreedte, betrouwbaarheid en methode. */
export const EstimateSchema = z.object({
  value: z.number(),
  low: z.number(),
  high: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  method: z.string(),
  currency: z.string().optional(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export function parseEstimate(raw: unknown): Estimate | null {
  const parsed = EstimateSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

const compact = (locale: string) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

export function formatCompact(n: number, locale = "en"): string {
  return compact(locale).format(n);
}

/** "€12K – €27K" */
export function formatEstimateRange(e: Estimate, locale = "en"): string {
  const fmt = (n: number) =>
    e.currency
      ? new Intl.NumberFormat(locale, { style: "currency", currency: e.currency, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(n)
      : compact(locale).format(n);
  return `${fmt(e.low)} – ${fmt(e.high)}`;
}
