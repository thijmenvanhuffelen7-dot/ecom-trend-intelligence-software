import "server-only";
import { getDb, sql } from "@trendscope/db";
import { chQuery } from "../clickhouse";
import { list, num, oneOf, page, range, str, type SearchParams } from "./params";

export const SHOP_SORTS = ["relevance", "visits", "visits_growth", "live_ads", "ads_growth", "newest", "products"] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];
export const CREATED_OPTIONS = ["d30", "d90", "y1", "older"] as const;
export const PAGE_SIZE = 25;

export interface ShopFilters {
  q?: string;
  view?: string;
  niches: string[];
  origin: string[];
  visitorCountries: string[];
  traffic: { min?: number; max?: number };
  trafficGrowthMin?: number;
  products: { min?: number; max?: number };
  created?: (typeof CREATED_OPTIONS)[number];
  pixels: string[];
  apps: string[];
  languages: string[];
  themes: string[];
  currencies: string[];
  liveAds: { min?: number; max?: number };
  adsGrowthMin?: number;
  sort: ShopSort;
  page: number;
}

export function parseShopFilters(sp: SearchParams): ShopFilters {
  const created = str(sp, "created");
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    view: str(sp, "view", 40),
    niches: list(sp, "niche"),
    origin: list(sp, "origin").map((c) => c.toUpperCase().slice(0, 2)),
    visitorCountries: list(sp, "vc").map((c) => c.toUpperCase().slice(0, 2)),
    traffic: range(sp, "traffic"),
    trafficGrowthMin: num(sp, "tg"),
    products: range(sp, "products"),
    created: (CREATED_OPTIONS as readonly string[]).includes(created ?? "") ? (created as ShopFilters["created"]) : undefined,
    pixels: list(sp, "pixels"),
    apps: list(sp, "apps"),
    languages: list(sp, "lang"),
    themes: list(sp, "theme"),
    currencies: list(sp, "cur"),
    liveAds: range(sp, "ads"),
    adsGrowthMin: num(sp, "ag"),
    sort: oneOf(sp, "sort", SHOP_SORTS, "relevance"),
    page: page(sp),
  };
}

export function activeFilterCount(f: ShopFilters): number {
  return [
    f.niches.length, f.origin.length, f.visitorCountries.length, f.traffic.min ?? f.traffic.max, f.trafficGrowthMin,
    f.products.min ?? f.products.max, f.created, f.pixels.length, f.apps.length, f.languages.length, f.themes.length,
    f.currencies.length, f.liveAds.min ?? f.liveAds.max, f.adsGrowthMin,
  ].filter((v) => v !== undefined && v !== 0).length;
}

function baseQuery(f: ShopFilters) {
  let q = getDb().selectFrom("stores as s").leftJoin("niches as n", "n.id", "s.niche_id");
  if (f.view) {
    q = q.where((eb) =>
      eb.exists(
        eb
          .selectFrom("curated_list_items as li")
          .innerJoin("curated_lists as l", "l.id", "li.list_id")
          .whereRef("li.entity_id", "=", "s.id")
          .where("l.slug", "=", f.view!)
          .where("l.entity_type", "=", "store"),
      ),
    );
  }
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    q = q.where((eb) => eb.or([eb("s.name", "ilike", like), eb("s.domain", "ilike", like)]));
  }
  if (f.niches.length) q = q.where("n.slug", "in", f.niches);
  if (f.origin.length) q = q.where("s.country", "in", f.origin);
  if (f.visitorCountries.length) {
    // minstens één van de gekozen landen in de top-5 bezoekerslanden
    q = q.where(
      sql<boolean>`exists (select 1 from jsonb_array_elements(s.visitor_countries) vc where vc->>'country' = any(${f.visitorCountries}::text[]))`,
    );
  }
  if (f.traffic.min !== undefined) q = q.where("s.monthly_visits", ">=", f.traffic.min);
  if (f.traffic.max !== undefined) q = q.where("s.monthly_visits", "<=", f.traffic.max);
  if (f.trafficGrowthMin !== undefined) q = q.where("s.visits_growth", ">=", f.trafficGrowthMin);
  if (f.products.min !== undefined) q = q.where("s.product_count", ">=", f.products.min);
  if (f.products.max !== undefined) q = q.where("s.product_count", "<=", f.products.max);
  if (f.created) {
    const days = { d30: 30, d90: 90, y1: 365, older: 365 }[f.created];
    q =
      f.created === "older"
        ? q.where("s.launched_at", "<", sql<string>`current_date - ${days}::int`)
        : q.where("s.launched_at", ">=", sql<string>`current_date - ${days}::int`);
  }
  for (const [type, names] of [["pixel", f.pixels], ["app", f.apps]] as const) {
    if (names.length) {
      q = q.where((eb) =>
        eb.exists(
          eb.selectFrom("store_technologies as t").whereRef("t.store_id", "=", "s.id").where("t.name", "in", names).where("t.removed_at", "is", null)
            .where("t.type", type === "app" ? "in" : "=", type === "app" ? ["app", "email", "reviews"] : "pixel"),
        ),
      );
    }
  }
  if (f.languages.length) q = q.where(sql<boolean>`s.languages && ${f.languages}::text[]`);
  if (f.themes.length) q = q.where("s.theme", "in", f.themes);
  if (f.currencies.length) q = q.where("s.currency", "in", f.currencies);
  if (f.liveAds.min !== undefined) q = q.where("s.live_ads", ">=", f.liveAds.min);
  if (f.liveAds.max !== undefined) q = q.where("s.live_ads", "<=", f.liveAds.max);
  if (f.adsGrowthMin !== undefined) q = q.where("s.ads_growth_30d", ">=", f.adsGrowthMin);
  return q;
}

export async function searchShops(f: ShopFilters) {
  const base = baseQuery(f);
  const [{ total }] = (await base.select(sql<number>`count(*)::int`.as("total")).execute()) as [{ total: number }];

  let q = base.select([
    "s.id", "s.name", "s.domain", "s.country", "s.launched_at", "s.monthly_visits", "s.visits_growth", "s.live_ads",
    "s.ads_growth_30d", "s.ads_launched_total", "s.product_count", "s.visitor_countries", "s.screenshot_url", "s.brand_color",
    "n.slug as niche_slug",
  ]);
  q = {
    relevance: q.orderBy(sql`(coalesce(s.visits_growth, 0) / 100 + 1) * ln(coalesce(s.monthly_visits, 0) + 10) + ln(s.live_ads + 1)`, "desc"),
    visits: q.orderBy("s.monthly_visits", sql`desc nulls last`),
    visits_growth: q.orderBy("s.visits_growth", sql`desc nulls last`),
    live_ads: q.orderBy("s.live_ads", "desc"),
    ads_growth: q.orderBy("s.ads_growth_30d", sql`desc nulls last`),
    newest: q.orderBy("s.launched_at", sql`desc nulls last`),
    products: q.orderBy("s.product_count", "desc"),
  }[f.sort].orderBy("s.id");

  const rows = await q.limit(PAGE_SIZE).offset((f.page - 1) * PAGE_SIZE).execute();
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { total, rows: [] };

  const db = getDb();
  const [bestSellers, secondaryNiches, latestAds, series] = await Promise.all([
    db
      .selectFrom("products")
      .select(["id", "store_id", "title", "images", "price", "currency", "best_seller_rank"])
      .where("store_id", "in", ids)
      .where("best_seller_rank", "<=", 3)
      .orderBy("best_seller_rank")
      .execute(),
    db
      .selectFrom("products as p")
      .innerJoin("cluster_members as cm", "cm.product_id", "p.id")
      .innerJoin("product_clusters as c", "c.id", "cm.cluster_id")
      .innerJoin("niches as n", "n.id", "c.niche_id")
      .select(["p.store_id", "n.slug"])
      .distinct()
      .where("p.store_id", "in", ids)
      .execute(),
    db
      .selectFrom("ads as a")
      .innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
      .select(["adv.store_id", "a.id", "a.thumbnail_url", "a.format", "a.start_date"])
      .where("adv.store_id", "in", ids)
      .orderBy("a.start_date", "desc")
      .execute(),
    chQuery<{ store_id: string; metric: string; values: number[] }>(
      `SELECT toString(store_id) AS store_id, metric, groupArray(v) AS values FROM (
         SELECT store_id, metric, toStartOfWeek(date) AS wk, avg(value) AS v
         FROM store_metrics_daily FINAL
         WHERE store_id IN {ids:Array(UInt64)} AND metric IN ('visits','live_ads') AND date >= today() - 182
         GROUP BY store_id, metric, wk ORDER BY wk
       ) GROUP BY store_id, metric`,
      { ids: ids.map(Number) },
    ),
  ]);

  return {
    total,
    rows: rows.map((r) => ({
      ...r,
      niches: [...new Set([r.niche_slug, ...secondaryNiches.filter((n) => n.store_id === r.id).map((n) => n.slug)].filter(Boolean) as string[])].slice(0, 2),
      bestSellers: bestSellers.filter((p) => p.store_id === r.id),
      latestAds: latestAds.filter((a) => a.store_id === r.id).slice(0, 3),
      visitsSeries: series.find((s) => s.store_id === r.id && s.metric === "visits")?.values ?? [],
      adsSeries: series.find((s) => s.store_id === r.id && s.metric === "live_ads")?.values ?? [],
    })),
  };
}

export type ShopRow = Awaited<ReturnType<typeof searchShops>>["rows"][number];

export async function shopFacets() {
  const db = getDb();
  const [niches, tech, themes, countries, languages, currencies, views, totals] = await Promise.all([
    db.selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("name_en").execute(),
    db
      .selectFrom("store_technologies")
      .select(["type", "name", sql<number>`count(*)::int`.as("count")])
      .where("removed_at", "is", null)
      .groupBy(["type", "name"])
      .orderBy("count", "desc")
      .execute(),
    db.selectFrom("stores").select(["theme as value", sql<number>`count(*)::int`.as("count")]).where("theme", "is not", null).groupBy("theme").orderBy("count", "desc").execute(),
    db.selectFrom("stores").select(["country as value", sql<number>`count(*)::int`.as("count")]).where("country", "is not", null).groupBy("country").orderBy("count", "desc").execute(),
    db.selectFrom(sql`(select unnest(languages) as value from stores)`.as("l")).select([sql<string>`value`.as("value"), sql<number>`count(*)::int`.as("count")]).groupBy("value").orderBy("count", "desc").execute(),
    db.selectFrom("stores").select(["currency as value", sql<number>`count(*)::int`.as("count")]).where("currency", "is not", null).groupBy("currency").orderBy("count", "desc").execute(),
    db.selectFrom("curated_lists").select(["slug", "name_nl", "name_en", "icon"]).where("entity_type", "=", "store").orderBy("position").execute(),
    db.selectFrom("stores").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow(),
  ]);
  return {
    niches,
    pixels: tech.filter((t) => t.type === "pixel").map((t) => ({ value: t.name, count: t.count })),
    apps: tech.filter((t) => ["app", "email", "reviews"].includes(t.type)).map((t) => ({ value: t.name, count: t.count })),
    themes: themes.map((t) => ({ value: t.value!, count: t.count })),
    countries: countries.map((t) => ({ value: t.value!, count: t.count })),
    languages: languages.map((t) => ({ value: t.value, count: t.count })),
    currencies: currencies.map((t) => ({ value: t.value!, count: t.count })),
    views,
    totalShops: totals.n,
  };
}

export type ShopFacets = Awaited<ReturnType<typeof shopFacets>>;
