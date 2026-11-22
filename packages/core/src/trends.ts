import type { Phase } from "./scoring";

/** log((gem. laatste w + k) / (gem. w daarvoor + k)); zelfde formule als de Python-engine. */
export function logGrowth(values: readonly number[], w: number, k = 3): number {
  if (values.length < 2 * w) return 0;
  const avg = (a: readonly number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return Math.log((avg(values.slice(-w)) + k) / (avg(values.slice(-2 * w, -w)) + k));
}

const pct = (g: number) => Math.round((Math.exp(g) - 1) * 1000) / 10;

/**
 * Groei (7d/30d, %) en trendfase van een keywordreeks — identiek aan `keyword_trend` in de worker
 * (workers/src/trendscope/trends/forecast.py), zodat een filter op land dezelfde regels gebruikt.
 */
export function keywordTrend(values: readonly number[]): { growth7d: number; growth30d: number; phase: Phase } {
  const g7 = logGrowth(values, 7);
  const g30 = logGrowth(values, 30);
  const top = values.length ? Math.max(...values) : 0;
  const last30 = values.slice(-30);
  const l30 = last30.reduce((s, v) => s + v, 0) / Math.max(1, last30.length);
  const first = values.slice(0, Math.floor(values.length / 2));
  const firstAvg = first.length ? first.reduce((s, v) => s + v, 0) / first.length : 0;
  const novelty = (l30 + 1) / (firstAvg + 1);
  const level = top ? l30 / top : 0;
  let phase: Phase;
  if (g30 < -0.1) phase = "declining";
  else if (g30 > 0.25 && novelty > 3) phase = "emerging";
  else if (g30 > 0.08) phase = "rising";
  else if (level >= 0.8) phase = "peak";
  else phase = "saturated";
  return { growth7d: pct(g7), growth30d: pct(g30), phase };
}
