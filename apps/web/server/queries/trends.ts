import "server-only";
import { getDb, sql } from "@trendscope/db";
import { keywordTrend, logGrowth, PHASES, type Phase } from "@trendscope/core";
import { chQuery } from "../clickhouse";
import { list, oneOf, str, type SearchParams } from "./params";

export const TREND_COUNTRIES = ["NL", "DE", "GB", "US"] as const;
export const TREND_KINDS = ["keyword", "hashtag"] as const;
export const TREND_PERIODS = ["7", "30", "90"] as const;
export const TREND_SORTS = ["growth", "interest", "newest"] as const;

export function parseTrendFilters(sp: SearchParams) {
  return {
    q: str(sp, "q", 80)?.trim() || undefined,
    kind: oneOf(sp, "kind", TREND_KINDS, "keyword"),
    country: oneOf(sp, "country", TREND_COUNTRIES, "NL"),
    period: oneOf(sp, "period", TREND_PERIODS, "30"),
    phases: list(sp, "phase", PHASES) as Phase[],
    niches: list(sp, "niche"),
    sort: oneOf(sp, "sort", TREND_SORTS, "growth"),
  };
}
export type TrendFilters = ReturnType<typeof parseTrendFilters>;

type Point = { id: string; d: string; v: number };

/** Reeks per keyword (dagwaarden, oudste eerst). Hashtags tellen gebruik in ads/video's (land = ALL). */
async function seriesFor(ids: number[], source: string, country: string, days: number) {
  if (!ids.length) return new Map<string, [string, number][]>();
  const rows = await chQuery<Point>(
    `SELECT toString(keyword_id) AS id, toString(date) AS d, argMax(value, updated_at) AS v FROM keyword_signals_daily
     WHERE keyword_id IN {ids:Array(UInt64)} AND source = {source:String} AND country = {country:String}
       AND date > today() - {days:UInt32}
     GROUP BY keyword_id, date ORDER BY keyword_id, date`,
    { ids, source, country, days },
  );
  const out = new Map<string, [string, number][]>();
  for (const r of rows) {
    if (!out.has(r.id)) out.set(r.id, []);
    out.get(r.id)!.push([r.d, Number(r.v)]);
  }
  return out;
}

export async function searchTrends(f: TrendFilters) {
  const db = getDb();
  let q = db
    .selectFrom("keywords as k")
    .leftJoin("niches as n", "n.id", "k.niche_id")
    .select([
      "k.id", "k.term", "k.kind", "k.interest", "k.phase", "k.peak_month", "k.seasonality", "k.first_seen", "n.slug as niche_slug",
      sql<string | null>`(select c.canonical_title from entity_links l join product_clusters c on c.id = l.to_id
        where l.from_type = 'keyword' and l.from_id = k.id and l.to_type = 'product_cluster' limit 1)`.as("product_title"),
      sql<string | null>`(select l.to_id::text from entity_links l
        where l.from_type = 'keyword' and l.from_id = k.id and l.to_type = 'product_cluster' limit 1)`.as("product_id"),
      sql<number>`(select count(*)::int from reddit_mentions r where r.keyword_id = k.id and r.created_at > now() - interval '7 days')`.as("reddit_7d"),
      sql<number | null>`(select f.trend_30d from forecasts f where f.entity_type = 'keyword' and f.entity_id = k.id)`.as("forecast_30d"),
    ])
    .where("k.kind", "=", f.kind)
    .where("k.updated_at", "is not", null);
  if (f.q) q = q.where("k.term", "ilike", `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  if (f.niches.length) q = q.where("n.slug", "in", f.niches);
  const rows = await q.limit(400).execute();

  // Groei en fase per gekozen land, met dezelfde regels als de worker (2 jaar nodig voor 'opkomend')
  const source = f.kind === "hashtag" ? "ads" : "search";
  const country = f.kind === "hashtag" ? "ALL" : f.country;
  const series = await seriesFor(rows.map((r) => Number(r.id)), source, country, 730);
  const period = Number(f.period);
  const enriched = rows
    .map((r) => {
      const s = series.get(String(r.id)) ?? [];
      const values = s.map((p) => p[1]);
      const trend = keywordTrend(values);
      const growth = Math.round((Math.exp(logGrowth(values, period)) - 1) * 1000) / 10;
      return {
        ...r,
        phase: (values.length >= 60 ? trend.phase : r.phase) as Phase | null,
        growth,
        growth7d: trend.growth7d,
        level: values.length ? Math.round(avg(values.slice(-7))) : null,
        spark: values.slice(-Math.max(28, period)),
      };
    })
    .filter((r) => !f.phases.length || (r.phase && f.phases.includes(r.phase)));
  enriched.sort((a, b) =>
    f.sort === "interest" ? (b.level ?? 0) - (a.level ?? 0) : f.sort === "newest" ? +new Date(b.first_seen) - +new Date(a.first_seen) : b.growth - a.growth,
  );
  return enriched;
}

function avg(a: number[]) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

export type TrendRow = Awaited<ReturnType<typeof searchTrends>>[number];

export async function seasonalCalendar() {
  return getDb()
    .selectFrom("keywords")
    .select(["id", "term", "peak_month", "seasonality", "phase"])
    .where("peak_month", "is not", null)
    .orderBy("seasonality", "desc")
    .execute();
}

export async function getKeyword(id: number) {
  const db = getDb();
  const k = await db
    .selectFrom("keywords as k")
    .leftJoin("niches as n", "n.id", "k.niche_id")
    .selectAll("k")
    .select(["n.slug as niche_slug", "n.name_nl", "n.name_en"])
    .where("k.id", "=", String(id))
    .executeTakeFirst();
  if (!k) return null;
  const source = k.kind === "hashtag" ? "ads" : "search";
  const countries = k.kind === "hashtag" ? ["ALL"] : [...TREND_COUNTRIES];
  const [perCountry, forecast, products, posts, reddit] = await Promise.all([
    Promise.all(countries.map(async (c) => [c, (await seriesFor([id], source, c, 730)).get(String(id)) ?? []] as const)),
    db.selectFrom("forecasts").selectAll().where("entity_type", "=", "keyword").where("entity_id", "=", String(id)).executeTakeFirst(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("product_clusters as c", "c.id", "l.to_id")
      .leftJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "c.store_count", "s.opportunity", "s.phase"])
      .where("l.from_type", "=", "keyword")
      .where("l.from_id", "=", String(id))
      .where("l.to_type", "=", "product_cluster")
      .execute(),
    db
      .selectFrom("reddit_mentions")
      .select(["id", "subreddit", "title", "url", "score", "comments", "created_at"])
      .where("keyword_id", "=", String(id))
      .orderBy("created_at", "desc")
      .limit(12)
      .execute(),
    seriesFor([id], "reddit", "ALL", 30),
  ]);
  return {
    keyword: k,
    series: Object.fromEntries(perCountry) as Record<string, [string, number][]>,
    forecast: forecast ? { ...forecast, points: forecast.points as unknown as { d: string; v: number; lo: number; hi: number }[] } : null,
    products,
    posts,
    reddit: reddit.get(String(id)) ?? [],
  };
}

export type KeywordDetail = NonNullable<Awaited<ReturnType<typeof getKeyword>>>;
