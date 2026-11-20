import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate } from "@trendscope/core";
import { chQuery } from "../clickhouse";
import { list, num, oneOf, page, str, type SearchParams } from "./params";

export const AD_SORTS = ["newest", "longest", "variants", "reach"] as const;
export const AD_PLATFORMS = ["meta", "tiktok", "google"] as const;
/** Weergaven zoals in ad-spy-tools: wat draait al lang (bewezen), wat schaalt op, wat is net gestart. */
export const AD_VIEWS = ["long-running", "scaling", "new-this-week", "new-advertisers"] as const;
export type AdView = (typeof AD_VIEWS)[number];
export const AD_PAGE_SIZE = 30;

export interface MediaItem {
  type: "image" | "video";
  url: string;
  poster?: string | null;
  storage_key?: string | null;
}

/** Media met een storage_key komen uit onze eigen S3-opslag (achter login); anders de bron-URL. */
export function mediaUrl(m: MediaItem | undefined | null): string | null {
  if (!m) return null;
  return m.storage_key ? `/api/media/${m.storage_key}` : (m.poster ?? m.url);
}

export function parseAdFilters(sp: SearchParams) {
  const status = str(sp, "status");
  const view = str(sp, "view");
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    view: (AD_VIEWS as readonly string[]).includes(view ?? "") ? (view as AdView) : undefined,
    status: status === "active" || status === "inactive" ? status : undefined,
    platforms: list(sp, "platform", AD_PLATFORMS),
    formats: list(sp, "format", ["video", "image", "carousel", "text"]),
    minDays: num(sp, "mindays"),
    countries: list(sp, "country").map((c) => c.toUpperCase().slice(0, 2)),
    ctas: list(sp, "cta"),
    shop: num(sp, "shop"),
    advertiser: num(sp, "advertiser"),
    sort: oneOf(sp, "sort", AD_SORTS, "newest"),
    page: page(sp),
  };
}

const daysRunning = sql<number>`(coalesce(a.end_date, current_date) - a.start_date)`;

export async function searchAds(f: ReturnType<typeof parseAdFilters>) {
  let q = getDb().selectFrom("ads as a").innerJoin("advertisers as adv", "adv.id", "a.advertiser_id").leftJoin("stores as s", "s.id", "adv.store_id");
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    q = q.where((eb) => eb.or([eb("a.body", "ilike", like), eb("a.headline", "ilike", like), eb("adv.name", "ilike", like)]));
  }
  if (f.view === "long-running") q = q.where("a.is_active", "=", true).where(daysRunning, ">=", 30);
  if (f.view === "scaling") q = q.where("a.is_active", "=", true).where("a.variants_count", ">=", 3);
  if (f.view === "new-this-week") q = q.where("a.first_seen", ">=", sql<Date>`now() - interval '7 days'`).where("a.start_date", ">=", sql<string>`current_date - 7`);
  if (f.view === "new-advertisers") q = q.where("adv.first_seen", ">=", sql<Date>`now() - interval '14 days'`);
  if (f.status) q = q.where("a.is_active", "=", f.status === "active");
  if (f.platforms.length) q = q.where(sql<boolean>`a.platform::text = any(${f.platforms}::text[])`);
  if (f.formats.length) q = q.where("a.format", "in", f.formats);
  if (f.minDays !== undefined) q = q.where(daysRunning, ">=", f.minDays);
  if (f.countries.length) q = q.where(sql<boolean>`a.countries && ${f.countries}::bpchar[]`);
  if (f.ctas.length) q = q.where("a.cta", "in", f.ctas);
  if (f.shop !== undefined) q = q.where("adv.store_id", "=", String(f.shop));
  if (f.advertiser !== undefined) q = q.where("adv.id", "=", String(f.advertiser));

  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  let rows = q.select([
    "a.id", "a.platform", "a.format", "a.body", "a.headline", "a.cta", "a.thumbnail_url", "a.media", "a.landing_url", "a.countries",
    "a.start_date", "a.end_date", "a.is_active", "a.variants_count", "a.est_reach", "a.est_spend", "a.publisher_platforms",
    "adv.id as advertiser_id", "adv.name as advertiser", "adv.avatar_url", "s.id as store_id", "s.domain", "s.name as store_name",
    daysRunning.as("days"),
  ]);
  rows = {
    newest: rows.orderBy("a.start_date", "desc"),
    longest: rows.orderBy(daysRunning, "desc"),
    variants: rows.orderBy("a.variants_count", "desc"),
    reach: rows.orderBy(sql`(a.est_reach->>'value')::numeric`, sql`desc nulls last`),
  }[f.sort].orderBy("a.id");
  const result = await rows.limit(AD_PAGE_SIZE).offset((f.page - 1) * AD_PAGE_SIZE).execute();
  return {
    total,
    rows: result.map((r) => ({
      ...r,
      thumb: mediaUrl((r.media as unknown as MediaItem[])[0]) ?? r.thumbnail_url,
      est_reach: parseEstimate(r.est_reach),
      est_spend: parseEstimate(r.est_spend),
    })),
  };
}

export type AdRow = Awaited<ReturnType<typeof searchAds>>["rows"][number];

export async function adFacets() {
  const db = getDb();
  const [ctas, countries, platforms, views] = await Promise.all([
    db.selectFrom("ads").select(["cta as value", sql<number>`count(*)::int`.as("count")]).where("cta", "is not", null).groupBy("cta").orderBy("count", "desc").execute(),
    db.selectFrom(sql`(select unnest(countries) as value from ads)`.as("c")).select([sql<string>`value`.as("value"), sql<number>`count(*)::int`.as("count")]).groupBy("value").orderBy("count", "desc").execute(),
    db.selectFrom("ads").select([sql<string>`platform::text`.as("value"), sql<number>`count(*)::int`.as("count")]).groupBy("platform").orderBy("count", "desc").execute(),
    sql<{ long_running: number; scaling: number; new_week: number; new_adv: number }>`
      select
        (select count(*)::int from ads where is_active and current_date - start_date >= 30) as long_running,
        (select count(*)::int from ads where is_active and variants_count >= 3) as scaling,
        (select count(*)::int from ads where first_seen >= now() - interval '7 days' and start_date >= current_date - 7) as new_week,
        (select count(*)::int from ads a join advertisers v on v.id = a.advertiser_id where v.first_seen >= now() - interval '14 days') as new_adv`.execute(db),
  ]);
  return {
    ctas: ctas.map((c) => ({ value: c.value!, count: c.count })),
    countries: countries.map((c) => ({ value: c.value.trim(), count: c.count })),
    platforms,
    viewCounts: views.rows[0]!,
  };
}

export async function getAd(id: number) {
  const db = getDb();
  const ad = await db
    .selectFrom("ads as a")
    .innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
    .leftJoin("stores as s", "s.id", "adv.store_id")
    .selectAll("a")
    .select([
      "adv.id as advertiser_id", "adv.name as advertiser", "adv.avatar_url", "adv.page_url", "adv.active_ads", "adv.total_ads",
      "s.id as store_id", "s.domain", "s.name as store_name", "s.screenshot_url", "s.country as store_country",
      daysRunning.as("days"),
    ])
    .where("a.id", "=", String(id))
    .executeTakeFirst();
  if (!ad) return null;
  const [variants, products, history] = await Promise.all([
    ad.creative_hash
      ? db
          .selectFrom("ads")
          .select(["id", "is_active", "countries", "start_date", "end_date", "publisher_platforms", "eu_reach"])
          .where("advertiser_id", "=", ad.advertiser_id)
          .where("creative_hash", "=", ad.creative_hash)
          .orderBy("start_date", "desc")
          .limit(20)
          .execute()
      : Promise.resolve([]),
    db
      .selectFrom("entity_links as l")
      .innerJoin("product_clusters as c", "c.id", "l.to_id")
      .leftJoin("scores as sc", (j) => j.onRef("sc.entity_id", "=", "c.id").on("sc.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "sc.opportunity", "sc.phase", "l.confidence", "l.evidence"])
      .where("l.from_type", "=", "ad")
      .where("l.from_id", "=", ad.id)
      .where("l.to_type", "=", "product_cluster")
      .execute(),
    chQuery<{ d: string; reach: number | null; active: number }>(
      `SELECT toString(toDate(captured_at)) AS d, max(views) AS reach, max(is_active) AS active FROM ad_snapshots FINAL
       WHERE ad_id = {id:UInt64} GROUP BY d ORDER BY d`,
      { id },
    ),
  ]);
  return {
    ad: { ...ad, est_reach: parseEstimate(ad.est_reach), est_spend: parseEstimate(ad.est_spend), media: ad.media as unknown as MediaItem[] },
    variants,
    products,
    history: history.filter((h) => h.reach != null).map((h) => [h.d, Number(h.reach)] as [string, number]),
  };
}

export type AdDetail = NonNullable<Awaited<ReturnType<typeof getAd>>>;

export async function searchAdvertisers(sp: SearchParams) {
  const q = str(sp, "q", 80)?.trim();
  const platforms = list(sp, "platform", AD_PLATFORMS);
  const p = page(sp);
  let base = getDb().selectFrom("advertisers as adv").leftJoin("stores as s", "s.id", "adv.store_id");
  if (q) base = base.where("adv.name", "ilike", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (platforms.length) base = base.where(sql<boolean>`adv.platform::text = any(${platforms}::text[])`);
  const { total } = await base.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await base
    .select([
      "adv.id", "adv.name", "adv.platform", "adv.first_seen", "adv.avatar_url", "adv.active_ads", "adv.total_ads",
      "adv.eu_reach_total", "adv.new_ads_7d", "adv.first_ad_at", "s.id as store_id", "s.domain", "s.screenshot_url", "s.country",
    ])
    .orderBy("adv.active_ads", "desc")
    .orderBy("adv.eu_reach_total", "desc")
    .orderBy("adv.id")
    .limit(AD_PAGE_SIZE)
    .offset((p - 1) * AD_PAGE_SIZE)
    .execute();
  return { total, rows, page: p };
}

export async function getAdvertiser(id: number) {
  const db = getDb();
  const adv = await db
    .selectFrom("advertisers as adv")
    .leftJoin("stores as s", "s.id", "adv.store_id")
    .selectAll("adv")
    .select(["s.id as store_id_", "s.domain", "s.name as store_name", "s.screenshot_url", "s.brand_color"])
    .where("adv.id", "=", String(id))
    .executeTakeFirst();
  if (!adv) return null;
  const [countries, formats, products, activity] = await Promise.all([
    db
      .selectFrom(sql`(select unnest(countries) as c from ads where advertiser_id = ${adv.id} and is_active)`.as("x"))
      .select([sql<string>`trim(c)`.as("country"), sql<number>`count(*)::int`.as("n")])
      .groupBy(sql`c`)
      .orderBy("n", "desc")
      .execute(),
    db.selectFrom("ads").select(["format", sql<number>`count(*)::int`.as("n")]).where("advertiser_id", "=", adv.id).groupBy("format").execute(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("ads as a", "a.id", "l.from_id")
      .innerJoin("product_clusters as c", "c.id", "l.to_id")
      .leftJoin("scores as sc", (j) => j.onRef("sc.entity_id", "=", "c.id").on("sc.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "sc.opportunity", "sc.phase", sql<number>`count(*)::int`.as("ads")])
      .where("l.from_type", "=", "ad")
      .where("l.to_type", "=", "product_cluster")
      .where("a.advertiser_id", "=", adv.id)
      .groupBy(["c.id", "c.canonical_title", "c.image_url", "sc.opportunity", "sc.phase"])
      .orderBy("ads", "desc")
      .limit(8)
      .execute(),
    // actieve ads per dag, gereconstrueerd uit start/einddatum (90 dagen)
    sql<{ d: string; active: number; started: number }>`
      select d::date::text as d,
        count(*) filter (where a.start_date <= d and (a.end_date is null or a.end_date >= d))::int as active,
        count(*) filter (where a.start_date = d)::int as started
      from generate_series(current_date - 89, current_date, interval '1 day') d
      left join ads a on a.advertiser_id = ${adv.id}
      group by d order by d`.execute(db),
  ]);
  return { adv, countries, formats, products, activity: activity.rows };
}
