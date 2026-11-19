import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate } from "@trendscope/core";
import { list, num, oneOf, page, str, type SearchParams } from "./params";

export const AD_SORTS = ["newest", "longest", "variants", "reach"] as const;
export const AD_PAGE_SIZE = 30;

export function parseAdFilters(sp: SearchParams) {
  const status = str(sp, "status");
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    status: status === "active" || status === "inactive" ? status : undefined,
    formats: list(sp, "format", ["video", "image", "carousel"]),
    minDays: num(sp, "mindays"),
    countries: list(sp, "country").map((c) => c.toUpperCase().slice(0, 2)),
    ctas: list(sp, "cta"),
    shop: num(sp, "shop"),
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
  if (f.status) q = q.where("a.is_active", "=", f.status === "active");
  if (f.formats.length) q = q.where("a.format", "in", f.formats);
  if (f.minDays !== undefined) q = q.where(daysRunning, ">=", f.minDays);
  if (f.countries.length) q = q.where(sql<boolean>`a.countries && ${f.countries}::bpchar[]`);
  if (f.ctas.length) q = q.where("a.cta", "in", f.ctas);
  if (f.shop !== undefined) q = q.where("adv.store_id", "=", String(f.shop));

  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  let rows = q.select([
    "a.id", "a.format", "a.body", "a.headline", "a.cta", "a.thumbnail_url", "a.landing_url", "a.countries", "a.start_date", "a.end_date",
    "a.is_active", "a.variants_count", "a.est_reach", "a.est_spend", "adv.name as advertiser", "s.id as store_id", "s.domain", "s.name as store_name",
    daysRunning.as("days"),
  ]);
  rows = {
    newest: rows.orderBy("a.start_date", "desc"),
    longest: rows.orderBy(daysRunning, "desc"),
    variants: rows.orderBy("a.variants_count", "desc"),
    reach: rows.orderBy(sql`(a.est_reach->>'value')::numeric`, sql`desc nulls last`),
  }[f.sort].orderBy("a.id");
  const result = await rows.limit(AD_PAGE_SIZE).offset((f.page - 1) * AD_PAGE_SIZE).execute();
  return { total, rows: result.map((r) => ({ ...r, est_reach: parseEstimate(r.est_reach), est_spend: parseEstimate(r.est_spend) })) };
}

export async function adFacets() {
  const db = getDb();
  const [ctas, countries] = await Promise.all([
    db.selectFrom("ads").select(["cta as value", sql<number>`count(*)::int`.as("count")]).where("cta", "is not", null).groupBy("cta").orderBy("count", "desc").execute(),
    db.selectFrom(sql`(select unnest(countries) as value from ads)`.as("c")).select([sql<string>`value`.as("value"), sql<number>`count(*)::int`.as("count")]).groupBy("value").orderBy("count", "desc").execute(),
  ]);
  return { ctas: ctas.map((c) => ({ value: c.value!, count: c.count })), countries: countries.map((c) => ({ value: c.value.trim(), count: c.count })) };
}

export async function searchAdvertisers(sp: SearchParams) {
  const q = str(sp, "q", 80)?.trim();
  const p = page(sp);
  let base = getDb().selectFrom("advertisers as adv").leftJoin("stores as s", "s.id", "adv.store_id");
  if (q) base = base.where("adv.name", "ilike", `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const { total } = await base.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await base
    .select([
      "adv.id", "adv.name", "adv.platform", "adv.first_seen", "s.id as store_id", "s.domain", "s.screenshot_url", "s.country",
      sql<number>`(select count(*)::int from ads a where a.advertiser_id = adv.id and a.is_active)`.as("active"),
      sql<number>`(select count(*)::int from ads a where a.advertiser_id = adv.id)`.as("total_ads"),
      sql<number>`(select coalesce(sum((a.est_reach->>'value')::numeric), 0)::float from ads a where a.advertiser_id = adv.id)`.as("reach"),
    ])
    .orderBy("active", "desc")
    .orderBy("reach", "desc")
    .limit(AD_PAGE_SIZE)
    .offset((p - 1) * AD_PAGE_SIZE)
    .execute();
  return { total, rows, page: p };
}
