import "server-only";
import { getDb, sql } from "@trendscope/db";
import { PLANS, type Feature, type PlanId } from "@trendscope/core";

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${new Date().toISOString().slice(0, 7)}-01`;

/** Gebruik per feature t.o.v. de planlimiet (voor de billing-pagina en upsell-meldingen). */
export async function usageOverview(workspaceId: string, plan: PlanId) {
  const db = getDb();
  const [counters, shops, rules, seats] = await Promise.all([
    db.selectFrom("usage_counters").select(["feature", "period_start", "used"]).where("workspace_id", "=", workspaceId).where("period_start", ">=", month()).execute(),
    db.selectFrom("watchlists").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", workspaceId).where("entity_type", "=", "store").executeTakeFirstOrThrow(),
    db.selectFrom("alert_rules").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", workspaceId).executeTakeFirstOrThrow(),
    db.selectFrom("memberships").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", workspaceId).executeTakeFirstOrThrow(),
  ]);
  const counter = (f: string, period: string) => counters.find((c) => c.feature === f && String(c.period_start).slice(0, 10) === period)?.used ?? 0;
  const used: Record<Feature, number> = {
    searches_per_day: counter("searches_per_day", today()),
    exports_per_month: counter("exports_per_month", month()),
    ai_assistant: counter("ai_assistant", month()),
    api_access: counter("api_access", month()),
    leads_export: counter("leads_export", month()),
    tracked_shops: shops.n,
    alerts: rules.n,
    seats: seats.n,
  };
  return (Object.keys(used) as Feature[]).map((f) => ({ feature: f, used: used[f], limit: PLANS[plan].limits[f] }));
}
