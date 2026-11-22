import "server-only";
import { parseEstimate } from "@trendscope/core";
import type { ProductDetail, ProductRow } from "@/server/queries/products";
import type { ShopRow } from "@/server/queries/shops";
import type { TrendRow } from "@/server/queries/trends";

/**
 * Publiek, stabiel API-formaat (v1): snake_case, ISO-datums, scores 0–100, saturatie 0–1.
 * Alles wat geschat is (omzet, bezoeken, verkopen) staat onder een object met `is_estimate: true`.
 */
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());
const round = (n: number | null | undefined, digits = 1) => (n == null ? null : Math.round(n * 10 ** digits) / 10 ** digits);

function scores(r: { opportunity: number | null; validation: number | null; saturation: number | null; growth_velocity: number | null; phase: string | null }) {
  if (r.opportunity == null) return null; // nog niet genoeg data (< 7 dagen): geen verzonnen score
  return { opportunity: round(r.opportunity), validation: round(r.validation), saturation: round(r.saturation, 3), growth_velocity: round(r.growth_velocity, 3), phase: r.phase };
}

export function productSummary(r: ProductRow) {
  return {
    id: Number(r.id),
    title: r.canonical_title,
    image_url: r.image_url,
    niche: r.niche_slug,
    price: { min: r.min_price, max: r.max_price, currency: r.currency },
    scores: scores(r),
    store_count: r.store_count,
    ad_count: r.ad_count,
    creator_count: r.creator_count,
    marketplace_orders_30d: r.marketplace_orders_30d == null ? null : { value: r.marketplace_orders_30d, is_estimate: true },
    min_supplier_cost: r.min_supplier_cost,
    curated: r.is_curated,
    first_seen: iso(r.first_seen),
    url: `${appUrl()}/explorer/products/${r.id}`,
  };
}

export function productDetail(d: ProductDetail) {
  const c = d.cluster;
  return {
    id: Number(c.id),
    title: c.canonical_title,
    image_url: c.image_url,
    niche: c.niche_slug,
    price: { min: c.min_price, max: c.max_price, currency: c.currency },
    scores: c.opportunity == null ? null : { ...scores(c)!, weights_version: c.weights_version, computed_at: iso(c.computed_at) },
    // Uitleg per signaal: waarom deze score (zelfde gegevens als "Waarom deze score?" in de app)
    explanation: c.breakdown,
    keywords: d.keywords.map((k) => ({ term: k.term, phase: k.phase })),
    stores: d.stores.map((s) => ({ id: Number(s.id), name: s.name, domain: s.domain, country: s.country, price: s.price, currency: s.currency, first_seen: iso(s.first_seen) })),
    ads: d.ads.map((a) => ({ id: Number(a.id), advertiser: a.advertiser, format: a.format, headline: a.headline, start_date: a.start_date, is_active: a.is_active, variants: a.variants_count })),
    suppliers: d.offers.map((o) => ({ name: o.name, source: o.source, price: o.price, shipping_cost: o.shipping_cost, currency: o.currency, shipping_days: o.shipping_days, url: o.url })),
    forecast: d.forecast ? { method: d.forecast.method, trend_30d: d.forecast.trend_30d, points: d.forecast.points, is_estimate: true } : null,
    first_seen: iso(c.first_seen),
    url: `${appUrl()}/explorer/products/${c.id}`,
  };
}

export function storeSummary(r: ShopRow) {
  return {
    id: Number(r.id),
    name: r.name,
    domain: r.domain,
    country: r.country,
    platform: r.platform,
    niches: r.niches,
    launched_at: r.launched_at,
    product_count: r.product_count,
    products_added_7d: r.products_added_7d,
    live_ads: r.live_ads,
    monthly_visits: r.monthly_visits == null ? null : { value: r.monthly_visits, growth_pct: r.visits_growth, is_estimate: true },
    url: `${appUrl()}/explorer/shops/${r.id}`,
  };
}

export type StoreRecord = {
  id: string; name: string | null; domain: string; country: string | null; platform: string; launched_at: string | null; product_count: number;
  live_ads: number; monthly_visits: number | null; visits_growth: number | null; est_revenue: unknown; theme: string | null; currency: string | null;
  languages: string[]; email_esp: string | null; emails_per_week: number | null; social: unknown; trustpilot: unknown; niche_slug: string | null; last_crawled: unknown;
};

export function storeDetail(s: StoreRecord, tech: { type: string; name: string }[], topProducts: { id: string; canonical_title: string; opportunity: number | null; phase: string | null }[]) {
  const revenue = parseEstimate(s.est_revenue);
  return {
    id: Number(s.id),
    name: s.name,
    domain: s.domain,
    country: s.country,
    platform: s.platform,
    niche: s.niche_slug,
    theme: s.theme,
    currency: s.currency,
    languages: s.languages,
    launched_at: s.launched_at,
    product_count: s.product_count,
    live_ads: s.live_ads,
    monthly_visits: s.monthly_visits == null ? null : { value: s.monthly_visits, growth_pct: s.visits_growth, is_estimate: true },
    monthly_revenue: revenue ? { value: revenue.value, low: revenue.low, high: revenue.high, confidence: revenue.confidence, currency: "EUR", is_estimate: true } : null,
    technologies: tech.map((t) => ({ type: t.type, name: t.name })),
    email_marketing: s.email_esp ? { provider: s.email_esp, emails_per_week: s.emails_per_week } : null,
    social: s.social,
    trustpilot: s.trustpilot,
    top_products: topProducts.map((p) => ({ id: Number(p.id), title: p.canonical_title, opportunity: round(p.opportunity), phase: p.phase, url: `${appUrl()}/explorer/products/${p.id}` })),
    last_crawled: iso(s.last_crawled),
    url: `${appUrl()}/explorer/shops/${s.id}`,
  };
}

export function trendSummary(r: TrendRow) {
  return {
    id: Number(r.id),
    term: r.term,
    kind: r.kind,
    niche: r.niche_slug,
    phase: r.phase,
    interest: r.level, // relatief 0–100 (zoals Google Trends), geen absoluut volume
    growth_pct: r.growth,
    growth_7d_pct: r.growth7d,
    seasonality: r.seasonality ? { peak_month: r.peak_month } : null,
    forecast_30d_pct: r.forecast_30d,
    reddit_mentions_7d: r.reddit_7d,
    product: r.product_id ? { id: Number(r.product_id), title: r.product_title, url: `${appUrl()}/explorer/products/${r.product_id}` } : null,
    series: r.spark,
  };
}
