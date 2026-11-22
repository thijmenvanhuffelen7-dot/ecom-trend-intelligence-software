import "server-only";
import { getDb, sql } from "@trendscope/db";
import { parseEstimate, PLANS, type PlanId } from "@trendscope/core";
import { list, num, str, type SearchParams } from "./params";

/**
 * B2B-leads: alleen publieke bedrijfsgegevens van webshops (domein, platform, techstack, bedrijfsaccounts op social,
 * geschatte omvang). Bewust géén persoonsgegevens: geen namen van eigenaren of medewerkers, geen persoonlijke e-mailadressen
 * of telefoonnummers. Wie een lead benadert, doet dat via de eigen contactkanalen van de winkel (zie docs/legal).
 */
export const LEAD_COLUMNS = [
  "domain", "name", "country", "platform", "niche", "launched_at", "product_count", "live_ads", "monthly_visits_est",
  "revenue_est_low", "revenue_est_high", "email_provider", "theme", "apps", "instagram", "tiktok", "facebook", "trustpilot_score", "trendscope_url",
] as const;

export function parseLeadFilters(sp: SearchParams) {
  const platform = str(sp, "platform", 20);
  return {
    niches: list(sp, "niche"),
    countries: list(sp, "country").map((c) => c.toUpperCase().slice(0, 2)),
    platform: platform && ["shopify", "woocommerce", "other"].includes(platform) ? platform : undefined,
    minVisits: num(sp, "min_visits"),
    hasAds: str(sp, "has_ads") === "1",
    esp: str(sp, "esp", 40),
    app: str(sp, "app", 60),
    limit: Math.min(1000, Math.max(1, num(sp, "limit") ?? 100)),
    offset: Math.max(0, num(sp, "offset") ?? 0),
  };
}
export type LeadFilters = ReturnType<typeof parseLeadFilters>;

const handle = (social: unknown, net: string) => {
  const h = (social as Record<string, string> | null)?.[net];
  return typeof h === "string" && /^[A-Za-z0-9._-]{1,40}$/.test(h) ? h : null;
};

export async function searchLeads(f: LeadFilters) {
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let q = getDb()
    .selectFrom("stores as s")
    .leftJoin("niches as n", "n.id", "s.niche_id")
    .where("s.is_active", "=", true);
  if (f.niches.length) q = q.where("n.slug", "in", f.niches);
  if (f.countries.length) q = q.where("s.country", "in", f.countries);
  if (f.platform) q = q.where(sql<boolean>`s.platform::text = ${f.platform}`);
  if (f.minVisits !== undefined) q = q.where("s.monthly_visits", ">=", f.minVisits);
  if (f.hasAds) q = q.where("s.live_ads", ">", 0);
  if (f.esp) q = q.where("s.email_esp", "ilike", f.esp);
  if (f.app) q = q.where(({ exists, selectFrom }) => exists(selectFrom("store_technologies as t").select(sql`1`.as("x")).whereRef("t.store_id", "=", "s.id").where("t.removed_at", "is", null).where("t.name", "ilike", f.app!)));

  const { total } = await q.select(sql<number>`count(*)::int`.as("total")).executeTakeFirstOrThrow();
  const rows = await q
    .select([
      "s.id", "s.domain", "s.name", "s.country", "s.platform", "n.slug as niche", "s.launched_at", "s.product_count", "s.live_ads",
      "s.monthly_visits", "s.est_revenue", "s.email_esp", "s.theme", "s.social", "s.trustpilot",
      sql<string[]>`coalesce((select array_agg(t.name order by t.name) from store_technologies t where t.store_id = s.id and t.removed_at is null and t.type = 'app'), '{}')`.as("apps"),
    ])
    .orderBy("s.monthly_visits", sql`desc nulls last`)
    .orderBy("s.id")
    .limit(f.limit)
    .offset(f.offset)
    .execute();
  return {
    total,
    rows: rows.map((r) => {
      const rev = parseEstimate(r.est_revenue);
      return {
        domain: r.domain,
        name: r.name,
        country: r.country,
        platform: r.platform,
        niche: r.niche,
        launched_at: r.launched_at,
        product_count: r.product_count,
        live_ads: r.live_ads,
        monthly_visits_est: r.monthly_visits,
        revenue_est_low: rev?.low ?? null,
        revenue_est_high: rev?.high ?? null,
        email_provider: r.email_esp,
        theme: r.theme,
        apps: r.apps,
        instagram: handle(r.social, "instagram"),
        tiktok: handle(r.social, "tiktok"),
        facebook: handle(r.social, "facebook"),
        trustpilot_score: (r.trustpilot as { score?: number } | null)?.score ?? null,
        trendscope_url: `${appUrl}/explorer/shops/${r.id}`,
      };
    }),
  };
}

/** Telt geleverde leads (rijen) per maand; geeft terug hoeveel er nog mogen. */
export async function reserveLeads(workspaceId: string, plan: PlanId, wanted: number): Promise<number> {
  const limit = PLANS[plan].limits.leads_export;
  if (limit <= 0 || wanted <= 0) return 0;
  const db = getDb();
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .insertInto("usage_counters")
      .values({ workspace_id: workspaceId, feature: "leads_export", period_start: month, used: 0 })
      .onConflict((oc) => oc.columns(["workspace_id", "feature", "period_start"]).doUpdateSet({ used: sql`usage_counters.used` }))
      .returning("used")
      .executeTakeFirstOrThrow();
    // ON CONFLICT DO UPDATE vergrendelt de rij tot de commit, dus gelijktijdige reserveringen zien elkaars verbruik
    const granted = Math.max(0, Math.min(wanted, (Number.isFinite(limit) ? limit : Number.MAX_SAFE_INTEGER) - row.used));
    if (granted > 0) {
      await trx.updateTable("usage_counters").set({ used: sql`used + ${granted}` }).where("workspace_id", "=", workspaceId).where("feature", "=", "leads_export").where("period_start", "=", month).execute();
    }
    return granted;
  });
}
