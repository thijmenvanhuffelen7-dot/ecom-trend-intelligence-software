import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate } from "@trendscope/core";
import { chQuery } from "../clickhouse";
import { list, num, oneOf, page, str, type SearchParams } from "./params";

export const SOCIAL_TABS = ["products", "shops", "creators", "videos", "lives"] as const;
export type SocialTab = (typeof SOCIAL_TABS)[number];
export const SOCIAL_PAGE = 40;
export const CREATOR_PLATFORMS = ["tiktok", "youtube", "instagram"] as const;

export function parseSocialFilters(sp: SearchParams) {
  return {
    tab: oneOf(sp, "tab", SOCIAL_TABS, "products"),
    q: str(sp, "q", 80)?.trim() || undefined,
    niches: list(sp, "niche"),
    platforms: list(sp, "platform", CREATOR_PLATFORMS),
    minFollowers: num(sp, "minfollowers"),
    minEngagement: num(sp, "mineng"),
    contact: str(sp, "contact") === "1",
    page: page(sp),
  };
}
export type SocialFilters = ReturnType<typeof parseSocialFilters>;

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

/** Verkopen per dag (Δ tellerstand) over 30 dagen, voor sparklines. */
async function soldSeries(ids: number[]) {
  if (!ids.length) return new Map<string, number[]>();
  const rows = await chQuery<{ id: string; values: number[] }>(
    `SELECT toString(product_id) AS id, groupArray(sold) AS values FROM (
       SELECT product_id, toDate(captured_at) AS d, max(orders) AS sold FROM product_snapshots
       WHERE product_id IN {ids:Array(UInt64)} AND captured_at > now() - INTERVAL 31 DAY AND orders IS NOT NULL
       GROUP BY product_id, d ORDER BY d)
     GROUP BY product_id`,
    { ids },
  );
  // cumulatieve teller → dagverkopen
  return new Map(rows.map((r) => [r.id, r.values.map(Number).slice(1).map((v, i) => Math.max(0, v - Number(r.values[i])))]));
}

export async function socialProducts(f: SocialFilters) {
  let q = getDb()
    .selectFrom("products as p")
    .innerJoin("tiktok_shops as s", "s.id", "p.tiktok_shop_id")
    .leftJoin("cluster_members as m", "m.product_id", "p.id")
    .leftJoin("product_clusters as c", "c.id", "m.cluster_id")
    .leftJoin("niches as n", "n.id", "c.niche_id")
    .where("p.source", "=", "tiktok_shop")
    .where("p.status", "!=", "removed");
  if (f.q) q = q.where("p.title", "ilike", like(f.q));
  if (f.niches.length) q = q.where("n.slug", "in", f.niches);
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "p.id", "p.title", "p.price", "p.currency", "p.sold_count", "p.orders_30d", "p.commission_rate", "p.url",
      sql<string | null>`p.images[1]`.as("image"), "s.id as shop_id", "s.name as shop_name", "c.id as cluster_id",
      "n.slug as niche_slug",
      sql<number>`(select count(*)::int from videos v where v.product_id = p.id)`.as("videos"),
    ])
    .orderBy(sql`p.orders_30d`, sql`desc nulls last`)
    .orderBy("p.id")
    .limit(SOCIAL_PAGE)
    .offset((f.page - 1) * SOCIAL_PAGE)
    .execute();
  const series = await soldSeries(rows.map((r) => Number(r.id)));
  return {
    total,
    rows: rows.map((r) => ({ ...r, gmv30: (r.orders_30d ?? 0) * Number(r.price ?? 0), spark: series.get(String(r.id)) ?? [] })),
  };
}

export async function socialShops(f: SocialFilters) {
  let q = getDb().selectFrom("tiktok_shops as s");
  if (f.q) q = q.where("s.name", "ilike", like(f.q));
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "s.id", "s.name", "s.country", "s.rating", "s.followers", "s.product_count", "s.sold_30d", "s.gmv_30d", "s.store_id",
      sql<string | null>`(select p.images[1] from products p where p.tiktok_shop_id = s.id order by p.orders_30d desc nulls last limit 1)`.as("image"),
      sql<string | null>`(select p.title from products p where p.tiktok_shop_id = s.id order by p.orders_30d desc nulls last limit 1)`.as("top_product"),
      sql<number>`(select count(*)::int from livestreams l where l.tiktok_shop_id = s.id and l.started_at > now() - interval '14 days')`.as("lives_14d"),
    ])
    .orderBy(sql`(s.gmv_30d->>'value')::numeric`, sql`desc nulls last`)
    .limit(SOCIAL_PAGE)
    .offset((f.page - 1) * SOCIAL_PAGE)
    .execute();
  return { total, rows: rows.map((r) => ({ ...r, gmv: parseEstimate(r.gmv_30d) })) };
}

export async function socialCreators(f: SocialFilters) {
  let q = getDb().selectFrom("creators as c");
  if (f.q) q = q.where((eb) => eb.or([eb("c.handle", "ilike", like(f.q!)), eb("c.display_name", "ilike", like(f.q!))]));
  if (f.platforms.length) q = q.where("c.platform", "in", f.platforms as ("tiktok" | "youtube" | "instagram")[]);
  if (f.niches.length) q = q.where(sql<boolean>`c.niches && ${sql.val(f.niches)}::text[]`);
  if (f.minFollowers !== undefined) q = q.where("c.followers", ">=", f.minFollowers);
  if (f.minEngagement !== undefined) q = q.where("c.engagement_rate", ">=", f.minEngagement / 100);
  if (f.contact) q = q.where("c.contact_public", "is not", null);
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "c.id", "c.platform", "c.handle", "c.display_name", "c.avatar_url", "c.followers", "c.followers_growth_7d", "c.engagement_rate",
      "c.avg_views", "c.niches", "c.country", "c.gmv_30d", "c.contact_public",
      sql<number>`(select count(*)::int from entity_links l where l.from_type = 'creator' and l.from_id = c.id and l.to_type = 'product_cluster')`.as("products"),
    ])
    .orderBy(sql`(c.gmv_30d->>'value')::numeric`, sql`desc nulls last`)
    .orderBy("c.followers", sql`desc nulls last`)
    .limit(SOCIAL_PAGE)
    .offset((f.page - 1) * SOCIAL_PAGE)
    .execute();
  return { total, rows: rows.map((r) => ({ ...r, gmv: parseEstimate(r.gmv_30d), hasContact: !!r.contact_public })) };
}

export async function socialVideos(f: SocialFilters) {
  let q = getDb()
    .selectFrom("videos as v")
    .innerJoin("creators as c", "c.id", "v.creator_id")
    .leftJoin("products as p", "p.id", "v.product_id")
    .where("v.posted_at", ">", sql<Date>`now() - interval '14 days'`);
  if (f.q) q = q.where("v.caption", "ilike", like(f.q));
  if (f.platforms.length) q = q.where("v.platform", "in", f.platforms as ("tiktok" | "youtube" | "instagram")[]);
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "v.id", "v.platform", "v.caption", "v.url", "v.thumbnail_url", "v.posted_at", "v.views", "v.likes", "v.comments", "v.shares",
      "v.views_24h", "c.id as creator_id", "c.handle", "c.avatar_url", "p.id as product_id", "p.title as product_title",
      sql<string | null>`(select l.to_id::text from entity_links l where l.from_type = 'video' and l.from_id = v.id and l.to_type = 'product_cluster' limit 1)`.as("cluster_id"),
    ])
    .orderBy("v.views_24h", sql`desc nulls last`)
    .orderBy("v.views", "desc")
    .limit(SOCIAL_PAGE)
    .offset((f.page - 1) * SOCIAL_PAGE)
    .execute();
  return { total, rows };
}

export async function socialLives(f: SocialFilters) {
  const q = getDb()
    .selectFrom("livestreams as l")
    .innerJoin("creators as c", "c.id", "l.creator_id")
    .leftJoin("tiktok_shops as s", "s.id", "l.tiktok_shop_id");
  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "l.id", "l.title", "l.started_at", "l.duration_min", "l.peak_viewers", "l.total_viewers", "l.units_sold", "l.gmv", "l.status",
      "c.id as creator_id", "c.handle", "c.avatar_url", "s.name as shop_name",
      sql<string[]>`(select coalesce(array_agg(p.title order by lp.units_sold desc), '{}') from livestream_products lp join products p on p.id = lp.product_id where lp.livestream_id = l.id)`.as("products"),
    ])
    .orderBy("l.started_at", "desc")
    .limit(SOCIAL_PAGE)
    .offset((f.page - 1) * SOCIAL_PAGE)
    .execute();
  return { total, rows: rows.map((r) => ({ ...r, gmvEst: parseEstimate(r.gmv) })) };
}

export async function getCreator(id: number) {
  const db = getDb();
  const c = await db.selectFrom("creators").selectAll().where("id", "=", String(id)).executeTakeFirst();
  if (!c) return null;
  const [videos, products, lives, followers] = await Promise.all([
    db
      .selectFrom("videos as v")
      .leftJoin("products as p", "p.id", "v.product_id")
      .select(["v.id", "v.caption", "v.url", "v.thumbnail_url", "v.posted_at", "v.views", "v.likes", "v.views_24h", "p.title as product_title"])
      .where("v.creator_id", "=", c.id)
      .orderBy("v.posted_at", "desc")
      .limit(12)
      .execute(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("product_clusters as pc", "pc.id", "l.to_id")
      .leftJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "pc.id").on("s.entity_type", "=", "product_cluster"))
      .select(["pc.id", "pc.canonical_title", "pc.image_url", "s.opportunity", "s.phase", "l.last_seen"])
      .where("l.from_type", "=", "creator")
      .where("l.from_id", "=", c.id)
      .where("l.to_type", "=", "product_cluster")
      .orderBy("l.last_seen", sql`desc nulls last`)
      .limit(10)
      .execute(),
    db
      .selectFrom("livestreams")
      .select(["id", "title", "started_at", "duration_min", "peak_viewers", "units_sold", "gmv"])
      .where("creator_id", "=", c.id)
      .orderBy("started_at", "desc")
      .limit(6)
      .execute(),
    chQuery<{ d: string; v: number }>(
      `SELECT toString(toDate(captured_at)) AS d, max(followers) AS v FROM creator_snapshots
       WHERE creator_id = {id:UInt64} GROUP BY d ORDER BY d`,
      { id },
    ),
  ]);
  return {
    creator: { ...c, gmv: parseEstimate(c.gmv_30d), contact: c.contact_public as { business_email?: string } | null },
    videos,
    products,
    lives: lives.map((l) => ({ ...l, gmvEst: parseEstimate(l.gmv) })),
    followers: followers.map((f) => [f.d, Number(f.v)] as [string, number]),
  };
}

export type CreatorDetail = NonNullable<Awaited<ReturnType<typeof getCreator>>>;

/** TikTok Shop-aanbod van een productcluster (voor de productpagina). */
export async function clusterTikTok(clusterId: string) {
  return getDb()
    .selectFrom("cluster_members as m")
    .innerJoin("products as p", "p.id", "m.product_id")
    .innerJoin("tiktok_shops as s", "s.id", "p.tiktok_shop_id")
    .select(["p.id", "p.title", "p.price", "p.currency", "p.sold_count", "p.orders_30d", "p.commission_rate", "s.id as shop_id", "s.name as shop_name"])
    .where("m.cluster_id", "=", clusterId)
    .orderBy(sql`p.orders_30d`, sql`desc nulls last`)
    .limit(8)
    .execute();
}
