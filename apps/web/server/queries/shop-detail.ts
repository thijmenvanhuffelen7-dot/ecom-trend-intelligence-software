import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate } from "@trendscope/core";
import { chQuery } from "../clickhouse";

export async function getShop(id: number, workspaceId: string) {
  const db = getDb();
  const shop = await db
    .selectFrom("stores as s")
    .leftJoin("niches as n", "n.id", "s.niche_id")
    .selectAll("s")
    .select(["n.slug as niche_slug", "n.name_nl as niche_nl", "n.name_en as niche_en"])
    .where("s.id", "=", String(id))
    .executeTakeFirst();
  if (!shop) return null;

  const [tech, bestSellers, latestProducts, ads, linked, watching, metrics] = await Promise.all([
    db.selectFrom("store_technologies").select(["type", "name", "detected_at"]).where("store_id", "=", shop.id).where("removed_at", "is", null).orderBy("name").execute(),
    db
      .selectFrom("products")
      .select(["id", "title", "images", "price", "currency", "first_seen", "best_seller_rank"])
      .where("store_id", "=", shop.id)
      .where("best_seller_rank", "is not", null)
      .orderBy("best_seller_rank")
      .limit(12)
      .execute(),
    db
      .selectFrom("products")
      .select(["id", "title", "images", "price", "currency", "first_seen", "best_seller_rank"])
      .where("store_id", "=", shop.id)
      .orderBy("first_seen", "desc")
      .limit(12)
      .execute(),
    db
      .selectFrom("ads as a")
      .innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
      .select(["a.id", "a.thumbnail_url", "a.format", "a.headline", "a.body", "a.cta", "a.start_date", "a.end_date", "a.is_active", "a.variants_count", "a.est_reach", "a.countries", "adv.name as advertiser"])
      .where("adv.store_id", "=", shop.id)
      .orderBy("a.is_active", "desc")
      .orderBy("a.start_date", "desc")
      .limit(8)
      .execute(),
    db
      .selectFrom("entity_links as l")
      .innerJoin("product_clusters as c", "c.id", "l.to_id")
      .innerJoin("scores as sc", (j) => j.onRef("sc.entity_id", "=", "c.id").on("sc.entity_type", "=", "product_cluster"))
      .select(["c.id", "c.canonical_title", "c.image_url", "c.store_count", "c.ad_count", "sc.opportunity", "sc.validation", "sc.saturation", "sc.phase", "sc.growth_velocity"])
      .where("l.from_type", "=", "store")
      .where("l.from_id", "=", shop.id)
      .where("l.to_type", "=", "product_cluster")
      .orderBy("sc.opportunity", "desc")
      .limit(8)
      .execute(),
    db.selectFrom("watchlists").select("id").where("workspace_id", "=", workspaceId).where("entity_type", "=", "store").where("entity_id", "=", shop.id).executeTakeFirst(),
    chQuery<{ metric: string; d: string; value: number }>(
      `SELECT metric, toString(date) AS d, value FROM store_metrics_daily FINAL
       WHERE store_id = {id:UInt64} AND date >= today() - 366 ORDER BY metric, date`,
      { id },
    ),
  ]);

  const series = (metric: string) => metrics.filter((m) => m.metric === metric).map((m) => [m.d, Number(m.value)] as [string, number]);
  const liveAds = series("live_ads");
  const growth = (days: number) => {
    const last = liveAds.at(-1)?.[1] ?? 0;
    const prev = liveAds.at(-1 - days)?.[1] ?? 0;
    return prev > 0 ? ((last - prev) / prev) * 100 : null;
  };

  return {
    shop: {
      ...shop,
      est_revenue: parseEstimate(shop.est_revenue),
      visitor_countries: shop.visitor_countries as { country: string; share: number }[],
      traffic_sources: shop.traffic_sources as Record<string, number>,
      social_followers: shop.social_followers as Record<string, number>,
      trustpilot: shop.trustpilot as { score: number; reviews: number } | null,
    },
    tech,
    bestSellers,
    latestProducts,
    ads,
    linked,
    watching: !!watching,
    visits: series("visits"),
    liveAds,
    liveAdsGrowth: { d7: growth(7), d30: growth(30), d90: growth(90) },
    followers: ["instagram", "tiktok", "facebook", "pinterest"].map((net) => ({ net, points: series(`followers_${net}`) })).filter((f) => f.points.some((p) => p[1] > 0)),
  };
}

export type ShopDetail = NonNullable<Awaited<ReturnType<typeof getShop>>>;
