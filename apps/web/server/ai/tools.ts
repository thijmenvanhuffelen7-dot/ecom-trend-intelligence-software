import "server-only";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { PHASES } from "@trendscope/core";

/**
 * Tools van de AI-assistent: alleen-lezen, begrensd (max. 15 rijen) en met geparametriseerde queries.
 * Elke tool geeft compacte JSON terug met app-links, zodat het antwoord naar de bron kan verwijzen.
 * De invoerschema's worden zowel door de tool runner (live) als door de offline-modus gebruikt.
 */
export const ToolInputs = {
  search_products: z.object({
    query: z.string().max(80).optional().describe("Zoekwoord in de productnaam"),
    niches: z.array(z.string().max(40)).max(5).optional().describe("Niche-slugs, zie list_niches"),
    phase: z.enum(PHASES).optional().describe("Trendfase"),
    min_validation: z.number().min(0).max(100).optional(),
    max_saturation: z.number().min(0).max(1).optional().describe("0–1; laag = weinig concurrentie"),
    max_price: z.number().positive().optional(),
    sort: z.enum(["opportunity", "growth", "validation", "newest"]).default("opportunity"),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  get_product: z.object({ id: z.number().int().positive().describe("Product-(cluster-)id") }),
  search_trends: z.object({
    query: z.string().max(80).optional(),
    phase: z.enum(PHASES).optional(),
    kind: z.enum(["keyword", "hashtag"]).default("keyword"),
    limit: z.number().int().min(1).max(15).default(10),
  }),
  search_stores: z.object({
    query: z.string().max(80).optional().describe("Naam of domein"),
    niche: z.string().max(40).optional(),
    country: z.string().length(2).optional().describe("ISO-landcode, bv. NL"),
    technology: z.string().max(40).optional().describe("Bijv. Klaviyo, Rebuy, TikTok Pixel"),
    sort: z.enum(["visits", "growth", "newest", "products_added"]).default("visits"),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  top_ads: z.object({
    product_id: z.number().int().positive().optional(),
    store_id: z.number().int().positive().optional(),
    active_only: z.boolean().default(true),
    sort: z.enum(["longest_running", "newest", "most_variants"]).default("longest_running"),
    limit: z.number().int().min(1).max(15).default(8),
  }),
  tiktok_top: z.object({ niche: z.string().max(40).optional(), limit: z.number().int().min(1).max(15).default(8) }),
  list_niches: z.object({}),
} as const;
export type ToolName = keyof typeof ToolInputs;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  search_products:
    "Zoek productclusters (hetzelfde product over winkels/marktplaatsen heen) met scores: opportuniteit, validatie (0-100), saturatie (0-1), groei en trendfase. Gebruik voor vragen als 'welke producten groeien', 'weinig concurrentie', 'onder €30'.",
  get_product:
    "Alle details van één product: scoreverklaring per signaal, winkels, ads, leveranciers en marge, zoektermen, TikTok Shop-verkopen en de vraagverwachting voor 30 dagen.",
  search_trends: "Zoektermen of hashtags met fase, groei (7/30 dagen), seizoenspiek en gekoppeld product.",
  search_stores: "Zoek webshops op naam, niche, land of gebruikte technologie, met (geschat) verkeer en groei.",
  top_ads: "Advertenties (Meta/TikTok/Google) voor een product of winkel: looptijd, varianten, actief, hook.",
  tiktok_top: "Best verkopende TikTok Shop-producten (stuks laatste 30 dagen, GMV-schatting) per niche.",
  list_niches: "Lijst van niches (slug + naam) om filters te kunnen gebruiken.",
};

const like = (q: string) => `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const round = (n: number | null | undefined, d = 0) => (n == null ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);

export async function runTool(name: ToolName, rawInput: unknown): Promise<unknown> {
  const db = getDb();
  switch (name) {
    case "list_niches":
      return db.selectFrom("niches").select(["slug", "name_nl", "name_en"]).orderBy("slug").execute();
    case "search_products": {
      const f = ToolInputs.search_products.parse(rawInput);
      let q = db
        .selectFrom("product_clusters as c")
        .innerJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
        .leftJoin("niches as n", "n.id", "c.niche_id")
        .select(["c.id", "c.canonical_title", "n.slug as niche", "c.min_price", "c.max_price", "c.store_count", "c.ad_count", "c.min_supplier_cost",
          "s.opportunity", "s.validation", "s.saturation", "s.growth_velocity", "s.phase"]);
      if (f.query) q = q.where("c.canonical_title", "ilike", like(f.query));
      if (f.niches?.length) q = q.where("n.slug", "in", f.niches);
      if (f.phase) q = q.where("s.phase", "=", f.phase);
      if (f.min_validation !== undefined) q = q.where("s.validation", ">=", f.min_validation);
      if (f.max_saturation !== undefined) q = q.where("s.saturation", "<=", f.max_saturation);
      if (f.max_price !== undefined) q = q.where("c.min_price", "<=", f.max_price);
      const order = { opportunity: "s.opportunity", growth: "s.growth_velocity", validation: "s.validation", newest: "c.first_seen" } as const;
      const rows = await q.orderBy(order[f.sort], "desc").limit(f.limit).execute();
      return rows.map((r) => ({
        id: Number(r.id), title: r.canonical_title, url: `/explorer/products/${r.id}`, niche: r.niche, phase: r.phase,
        opportunity: round(r.opportunity), validation: round(r.validation), saturation: round(r.saturation, 2), growth_pct: round(r.growth_velocity),
        price_range: [round(r.min_price, 2), round(r.max_price, 2)], lowest_supplier_cost: round(r.min_supplier_cost, 2),
        stores: r.store_count, ads: r.ad_count,
      }));
    }
    case "get_product": {
      const { id } = ToolInputs.get_product.parse(rawInput);
      const c = await db
        .selectFrom("product_clusters as c")
        .leftJoin("scores as s", (j) => j.onRef("s.entity_id", "=", "c.id").on("s.entity_type", "=", "product_cluster"))
        .leftJoin("niches as n", "n.id", "c.niche_id")
        .select(["c.id", "c.canonical_title", "n.slug as niche", "c.min_price", "c.max_price", "c.store_count", "c.ad_count", "c.creator_count",
          "c.min_supplier_cost", "c.marketplace_orders_30d", "s.opportunity", "s.validation", "s.saturation", "s.growth_velocity", "s.phase", "s.breakdown"])
        .where("c.id", "=", String(id))
        .executeTakeFirst();
      if (!c) return { error: "not_found" };
      const [keywords, forecast, tiktok, offers] = await Promise.all([
        db.selectFrom("entity_links as l").innerJoin("keywords as k", "k.id", "l.from_id").select(["k.term", "k.phase", "k.growth_30d", "k.peak_month"])
          .where("l.from_type", "=", "keyword").where("l.to_type", "=", "product_cluster").where("l.to_id", "=", c.id).execute(),
        db.selectFrom("forecasts").select(["trend_30d", "mape"]).where("entity_type", "=", "product_cluster").where("entity_id", "=", c.id).executeTakeFirst(),
        db.selectFrom("cluster_members as m").innerJoin("products as p", "p.id", "m.product_id")
          .select([sql<number>`coalesce(sum(p.orders_30d), 0)::int`.as("units"), sql<number>`count(*)::int`.as("listings")])
          .where("m.cluster_id", "=", c.id).where("p.source", "=", "tiktok_shop").executeTakeFirst(),
        db.selectFrom("supplier_offers as o").innerJoin("suppliers as su", "su.id", "o.supplier_id")
          .select(["su.name", "su.source", "o.price", "o.shipping_cost", sql<string>`o.shipping_days::text`.as("days")])
          .where("o.cluster_id", "=", c.id).orderBy(sql`o.price + coalesce(o.shipping_cost, 0)`).limit(3).execute(),
      ]);
      const b = c.breakdown as { signals?: { signal: string; positive: boolean; growth_7d: number; growth_30d: number }[]; notes?: string[]; margin?: number } | null;
      return {
        id, title: c.canonical_title, url: `/explorer/products/${id}`, niche: c.niche, phase: c.phase,
        scores: { opportunity: round(c.opportunity), validation: round(c.validation), saturation: round(c.saturation, 2), growth_pct: round(c.growth_velocity) },
        signals: b?.signals?.map((s) => ({ signal: s.signal, positive: s.positive, growth_7d_pct: s.growth_7d, growth_30d_pct: s.growth_30d })) ?? [],
        score_notes: b?.notes ?? [], margin: round(b?.margin, 2),
        price_range: [round(c.min_price, 2), round(c.max_price, 2)], stores: c.store_count, ads: c.ad_count, creators: c.creator_count,
        marketplace_orders_30d: c.marketplace_orders_30d, tiktok_shop: tiktok ?? null,
        cheapest_suppliers: offers.map((o) => ({ ...o, price: round(o.price, 2), shipping_cost: round(o.shipping_cost, 2) })),
        search_terms: keywords, demand_forecast_30d_pct: forecast?.trend_30d ?? null, forecast_error_pct: forecast?.mape ?? null,
        note: "Omzet-, GMV- en verkoopcijfers zijn schattingen.",
      };
    }
    case "search_trends": {
      const f = ToolInputs.search_trends.parse(rawInput);
      let q = db.selectFrom("keywords as k").select(["k.id", "k.term", "k.phase", "k.growth_7d", "k.growth_30d", "k.peak_month", "k.interest",
        sql<string | null>`(select c.canonical_title from entity_links l join product_clusters c on c.id = l.to_id where l.from_type = 'keyword' and l.from_id = k.id and l.to_type = 'product_cluster' limit 1)`.as("product")])
        .where("k.kind", "=", f.kind).where("k.updated_at", "is not", null);
      if (f.query) q = q.where("k.term", "ilike", like(f.query));
      if (f.phase) q = q.where("k.phase", "=", f.phase);
      const rows = await q.orderBy("k.growth_30d", sql`desc nulls last`).limit(f.limit).execute();
      return rows.map((r) => ({ ...r, id: Number(r.id), url: `/trends/${r.id}`, growth_7d: round(r.growth_7d), growth_30d: round(r.growth_30d), interest: round(r.interest) }));
    }
    case "search_stores": {
      const f = ToolInputs.search_stores.parse(rawInput);
      let q = db.selectFrom("stores as s").leftJoin("niches as n", "n.id", "s.niche_id")
        .select(["s.id", "s.name", "s.domain", "s.country", "n.slug as niche", "s.monthly_visits", "s.visits_growth", "s.product_count", "s.products_added_7d", "s.live_ads", "s.first_seen"]);
      if (f.query) q = q.where((eb) => eb.or([eb("s.name", "ilike", like(f.query!)), eb("s.domain", "ilike", like(f.query!))]));
      if (f.niche) q = q.where("n.slug", "=", f.niche);
      if (f.country) q = q.where("s.country", "=", f.country.toUpperCase());
      if (f.technology) q = q.where("s.id", "in", db.selectFrom("store_technologies").select("store_id").where("name", "ilike", f.technology).where("removed_at", "is", null));
      const order = { visits: "s.monthly_visits", growth: "s.visits_growth", newest: "s.first_seen", products_added: "s.products_added_7d" } as const;
      const rows = await q.orderBy(order[f.sort], sql`desc nulls last`).limit(f.limit).execute();
      return rows.map((r) => ({ ...r, id: Number(r.id), url: `/explorer/shops/${r.id}`, monthly_visits_estimate: r.monthly_visits, monthly_visits: undefined }));
    }
    case "top_ads": {
      const f = ToolInputs.top_ads.parse(rawInput);
      let q = db.selectFrom("ads as a").innerJoin("advertisers as adv", "adv.id", "a.advertiser_id")
        .select(["a.id", "a.platform", "a.headline", "a.hook", "a.start_date", "a.end_date", "a.is_active", "a.variants_count", "adv.name as advertiser",
          sql<number>`(coalesce(a.end_date, now())::date - a.start_date::date)`.as("days_running")]);
      if (f.product_id) q = q.where("a.id", "in", db.selectFrom("entity_links").select("from_id").where("from_type", "=", "ad").where("to_type", "=", "product_cluster").where("to_id", "=", String(f.product_id)));
      if (f.store_id) q = q.where("adv.store_id", "=", String(f.store_id));
      if (f.active_only) q = q.where("a.is_active", "=", true);
      const order = { longest_running: sql`(coalesce(a.end_date, now())::date - a.start_date::date) desc`, newest: sql`a.start_date desc`, most_variants: sql`a.variants_count desc` }[f.sort];
      const rows = await q.orderBy(order).limit(f.limit).execute();
      return rows.map((r) => ({ ...r, id: Number(r.id), url: `/explorer/ads/${r.id}` }));
    }
    case "tiktok_top": {
      const f = ToolInputs.tiktok_top.parse(rawInput);
      let q = db.selectFrom("products as p").innerJoin("tiktok_shops as s", "s.id", "p.tiktok_shop_id")
        .leftJoin("cluster_members as m", "m.product_id", "p.id").leftJoin("product_clusters as c", "c.id", "m.cluster_id").leftJoin("niches as n", "n.id", "c.niche_id")
        .select(["p.title", "p.price", "p.orders_30d", "p.commission_rate", "s.name as shop", "c.id as product_id"])
        .where("p.source", "=", "tiktok_shop");
      if (f.niche) q = q.where("n.slug", "=", f.niche);
      const rows = await q.orderBy("p.orders_30d", sql`desc nulls last`).limit(f.limit).execute();
      return rows.map((r) => ({ ...r, units_30d: r.orders_30d, gmv_30d_estimate: round((r.orders_30d ?? 0) * Number(r.price ?? 0)), url: r.product_id ? `/explorer/products/${r.product_id}` : "/social" }));
    }
  }
}
