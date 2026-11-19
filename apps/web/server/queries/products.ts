import "server-only";
import { getDb, sql } from "@trendscope/db";
import { PHASES, type Phase, type ScoreBreakdown } from "@trendscope/core";
import { chQuery } from "../clickhouse";
import { list, num, oneOf, page, range, str, type SearchParams } from "./params";

export const PRODUCT_SORTS = ["opportunity", "validation", "growth", "saturation_asc", "stores", "newest"] as const;
export const PRODUCT_PAGE_SIZE = 30;

export function parseProductFilters(sp: SearchParams) {
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    niches: list(sp, "niche"),
    phases: list(sp, "phase", PHASES) as Phase[],
    minValidation: num(sp, "minval"),
    maxSaturation: num(sp, "maxsat"),
    price: range(sp, "price"),
    curated: str(sp, "curated") === "1",
    sort: oneOf(sp, "sort", PRODUCT_SORTS, "opportunity"),
    page: page(sp),
  };
}
export type ProductFilters = ReturnType<typeof parseProductFilters>;

export async function searchProducts(f: ProductFilters) {
  let q = getDb()
    .selectFrom("product_clusters as c")
    .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
    .leftJoin("niches as n", "n.id", "c.niche_id");
  if (f.q) q = q.where("c.canonical_title", "ilike", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.niches.length) q = q.where("n.slug", "in", f.niches);
  if (f.phases.length) q = q.where("s.phase", "in", f.phases);
  if (f.minValidation !== undefined) q = q.where("s.validation", ">=", f.minValidation);
  if (f.maxSaturation !== undefined) q = q.where("s.saturation", "<=", f.maxSaturation / 100);
  if (f.price.min !== undefined) q = q.where("c.max_price", ">=", f.price.min);
  if (f.price.max !== undefined) q = q.where("c.min_price", "<=", f.price.max);
  if (f.curated) q = q.where("c.is_curated", "=", true);

  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  let rows = q.select([
    "c.id", "c.canonical_title", "c.image_url", "c.min_price", "c.max_price", "c.currency", "c.store_count", "c.ad_count",
    "c.creator_count", "c.is_curated", "c.first_seen", "n.slug as niche_slug", "s.opportunity", "s.validation", "s.saturation",
    "s.growth_velocity", "s.phase", "s.breakdown",
  ]);
  rows = {
    opportunity: rows.orderBy("s.opportunity", "desc"),
    validation: rows.orderBy("s.validation", "desc"),
    growth: rows.orderBy("s.growth_velocity", "desc"),
    saturation_asc: rows.orderBy("s.saturation", "asc"),
    stores: rows.orderBy("c.store_count", "desc"),
    newest: rows.orderBy("c.first_seen", "desc"),
  }[f.sort].orderBy("c.id");
  const result = await rows.limit(PRODUCT_PAGE_SIZE).offset((f.page - 1) * PRODUCT_PAGE_SIZE).execute();
  const ids = result.map((r) => Number(r.id));
  const demand = ids.length
    ? await chQuery<{ id: string; values: number[] }>(
        `SELECT toString(entity_id) AS id, groupArray(v) AS values FROM (
           SELECT entity_id, date, sum(value) AS v FROM entity_signals_daily FINAL
           WHERE entity_type = 'product_cluster' AND entity_id IN {ids:Array(UInt64)} AND source IN ('search','social')
           GROUP BY entity_id, date ORDER BY date
         ) GROUP BY entity_id`,
        { ids },
      )
    : [];
  return {
    total,
    rows: result.map((r) => ({
      ...r,
      breakdown: r.breakdown as unknown as ScoreBreakdown,
      demand: demand.find((d) => d.id === r.id)?.values.map(Number) ?? [],
    })),
  };
}

export type ProductRow = Awaited<ReturnType<typeof searchProducts>>["rows"][number];

export async function getProduct(id: number, workspaceId: string) {
  const db = getDb();
  const cluster = await db
    .selectFrom("product_clusters as c")
    .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
    .leftJoin("niches as n", "n.id", "c.niche_id")
    .selectAll("c")
    .select(["s.opportunity", "s.validation", "s.saturation", "s.growth_velocity", "s.phase", "s.breakdown", "s.weights_version", "s.computed_at", "n.slug as niche_slug", "n.name_nl", "n.name_en"])
    .where("c.id", "=", String(id))
    .executeTakeFirst();
  if (!cluster) return null;

  const [stores, ads, videos, offers, similar, signals, history, watching] = await Promise.all([
    db
      .selectFrom("cluster_members as m")
      .innerJoin("products as p", "p.id", "m.product_id")
      .innerJoin("stores as st", "st.id", "p.store_id")
      .select(["st.id", "st.name", "st.domain", "st.country", "st.monthly_visits", "st.visits_growth", "st.screenshot_url", "p.price", "p.currency", "p.first_seen", "m.confidence", "m.method"])
      .where("m.cluster_id", "=", cluster.id)
      .orderBy("st.monthly_visits", sql`desc nulls last`)
      .orderBy("p.price")
      .limit(60)
      .execute()
      // één rij per winkel (de goedkoopste variant)
      .then((rows) => rows.filter((r, i) => rows.findIndex((x) => x.id === r.id) === i).slice(0, 12)),
    db
      .selectFrom("entity_links as l")
      .innerJoin("ads as a", "a.id", "l.from_id")
      .innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
      .select(["a.id", "a.thumbnail_url", "a.format", "a.headline", "a.start_date", "a.end_date", "a.is_active", "a.variants_count", "adv.name as advertiser", "adv.store_id"])
      .where("l.to_type", "=", "product_cluster")
      .where("l.to_id", "=", cluster.id)
      .where("l.from_type", "=", "ad")
      .orderBy("a.is_active", "desc")
      .orderBy("a.start_date", "desc")
      .limit(8)
      .execute(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("videos as v", "v.id", "l.from_id")
      .innerJoin("creators as cr", "cr.id", "v.creator_id")
      .select(["v.id", "v.caption", "v.thumbnail_url", "v.views", "v.likes", "v.posted_at", "cr.handle", "cr.avatar_url", "cr.followers"])
      .where("l.to_type", "=", "product_cluster")
      .where("l.to_id", "=", cluster.id)
      .where("l.from_type", "=", "video")
      .orderBy("v.views", "desc")
      .limit(3)
      .execute(),
    db
      .selectFrom("supplier_offers as o")
      .innerJoin("suppliers as su", "su.id", "o.supplier_id")
      .select(["o.id", "o.price", "o.shipping_cost", "o.currency", "o.orders", sql<string>`o.shipping_days::text`.as("shipping_days"), "su.name", "su.source", "su.rating"])
      .where("o.cluster_id", "=", cluster.id)
      .orderBy("o.price")
      .execute(),
    db
      .selectFrom("product_clusters as c")
      .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "s.opportunity", "s.phase"])
      .where("c.niche_id", "=", cluster.niche_id)
      .where("c.id", "!=", cluster.id)
      .orderBy("s.opportunity", "desc")
      .limit(5)
      .execute(),
    chQuery<{ source: string; d: string; value: number }>(
      `SELECT source, toString(date) AS d, value FROM entity_signals_daily FINAL
       WHERE entity_type = 'product_cluster' AND entity_id = {id:UInt64} ORDER BY source, date`,
      { id },
    ),
    chQuery<{ d: string; opportunity: number; validation: number; saturation: number }>(
      `SELECT toString(date) AS d, opportunity, validation, saturation * 100 AS saturation FROM score_history FINAL
       WHERE entity_type = 'product_cluster' AND entity_id = {id:UInt64} ORDER BY date`,
      { id },
    ),
    db.selectFrom("watchlists").select("id").where("workspace_id", "=", workspaceId).where("entity_type", "=", "product_cluster").where("entity_id", "=", cluster.id).executeTakeFirst(),
  ]);

  const bySource = new Map<string, [string, number][]>();
  for (const s of signals) {
    if (!bySource.has(s.source)) bySource.set(s.source, []);
    bySource.get(s.source)!.push([s.d, Number(s.value)]);
  }

  return {
    cluster: { ...cluster, breakdown: cluster.breakdown as unknown as ScoreBreakdown, phase: cluster.phase as Phase },
    stores,
    ads,
    videos,
    offers,
    similar,
    signals: bySource,
    history,
    watching: !!watching,
  };
}

export type ProductDetail = NonNullable<Awaited<ReturnType<typeof getProduct>>>;
