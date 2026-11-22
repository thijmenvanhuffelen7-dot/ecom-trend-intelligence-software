/** Signalen met een gewicht in de opportunity-score (zelfde sleutels als `score_weights.weights` en scoring/live.py). */
export const WEIGHT_SIGNALS = ["store", "ads", "marketplace", "search", "reddit", "social", "tiktokshop", "price"] as const;
export type WeightSignal = (typeof WEIGHT_SIGNALS)[number];
