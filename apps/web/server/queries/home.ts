import "server-only";
import { getDb, sql } from "@trendscope/db";
import type { Phase } from "@trendscope/core";
import { chQuery } from "../clickhouse";

export async function getHome(niches: string[]) {
  const db = getDb();
  const nicheFilter = niches.length ? sql`and n.slug = any(${niches}::text[])` : sql``;
  const [kpi, top, scaling, newAds, nicheRows, phases] = await Promise.all([
    sql<{ opportunities: number; emerging: number; scaling: number; new_ads: number }>`
      select
        (select count(*)::int from scores s join product_clusters c on c.id = s.entity_id left join niches n on n.id = c.niche_id where s.entity_type = 'product_cluster' and s.opportunity >= 60 ${nicheFilter}) as opportunities,
        (select count(*)::int from scores s join product_clusters c on c.id = s.entity_id left join niches n on n.id = c.niche_id where s.entity_type = 'product_cluster' and s.phase = 'emerging' ${nicheFilter}) as emerging,
        (select count(*)::int from stores where visits_growth >= 25) as scaling,
        (select count(*)::int from ads where start_date >= current_date - 7) as new_ads`.execute(db),
    db
      .selectFrom("product_clusters as c")
      .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .leftJoin("niches as n", "n.id", "c.niche_id")
      .select(["c.id", "c.canonical_title", "c.image_url", "c.store_count", "c.ad_count", "c.min_price", "c.currency", "s.opportunity", "s.validation", "s.saturation", "s.growth_velocity", "s.phase", "n.slug as niche_slug"])
      .$if(niches.length > 0, (q) => q.where("n.slug", "in", niches))
      .orderBy("s.opportunity", "desc")
      .limit(6)
      .execute(),
    db
      .selectFrom("stores")
      .select(["id", "name", "domain", "country", "monthly_visits", "visits_growth", "screenshot_url"])
      .where("monthly_visits", ">=", 20_000)
      .orderBy("visits_growth", sql`desc nulls last`)
      .limit(6)
      .execute(),
    db
      .selectFrom("ads as a")
      .innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
      .select(["a.id", "a.thumbnail_url", "a.format", "a.start_date", "a.headline", "adv.name as advertiser", "adv.store_id"])
      .where("a.is_active", "=", true)
      .orderBy("a.start_date", "desc")
      .orderBy("a.variants_count", "desc")
      .limit(6)
      .execute(),
    db
      .selectFrom("product_clusters as c")
      .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
      .innerJoin("niches as n", "n.id", "c.niche_id")
      .select(["n.slug", "n.name_nl", "n.name_en", sql<number>`avg(s.opportunity)::float`.as("avg_opp"), sql<number>`avg(s.growth_velocity)::float`.as("avg_growth")])
      .groupBy(["n.slug", "n.name_nl", "n.name_en"])
      .orderBy("avg_opp", "desc")
      .execute(),
    db.selectFrom("scores").select(["phase", sql<number>`count(*)::int`.as("n")]).where("entity_type", "=", "product_cluster").groupBy("phase").execute(),
  ]);
  const ids = scaling.map((s) => Number(s.id));
  const series = ids.length
    ? await chQuery<{ id: string; values: number[] }>(
        `SELECT toString(store_id) AS id, groupArray(v) AS values FROM (
           SELECT store_id, toStartOfWeek(date) AS wk, avg(value) AS v FROM store_metrics_daily FINAL
           WHERE store_id IN {ids:Array(UInt64)} AND metric = 'visits' AND date >= today() - 120 GROUP BY store_id, wk ORDER BY wk
         ) GROUP BY store_id`,
        { ids },
      )
    : [];
  return {
    kpi: kpi.rows[0]!,
    top: top.map((r) => ({ ...r, phase: r.phase as Phase })),
    scaling: scaling.map((s) => ({ ...s, series: series.find((x) => x.id === s.id)?.values.map(Number) ?? [] })),
    newAds,
    niches: nicheRows,
    phases: phases.map((p) => ({ phase: p.phase as Phase, n: p.n })),
  };
}
