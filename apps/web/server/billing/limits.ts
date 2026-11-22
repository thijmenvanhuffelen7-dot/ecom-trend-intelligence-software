import "server-only";
import { getDb, sql } from "@trendscope/db";
import { PLANS } from "@trendscope/core";
import type { Session } from "@/lib/auth/server";

/** Telt een zoekopdracht (per dag). Geeft false als de daglimiet van het plan al bereikt is (dan telt hij niet). */
export async function consumeSearch(session: Session): Promise<boolean> {
  const limit = PLANS[session.workspace.plan].limits.searches_per_day;
  if (limit === Infinity) return true;
  const day = new Date().toISOString().slice(0, 10);
  const row = await getDb()
    .insertInto("usage_counters")
    .values({ workspace_id: session.workspace.id, feature: "searches_per_day", period_start: day, used: 1 })
    .onConflict((oc) => oc.columns(["workspace_id", "feature", "period_start"]).doUpdateSet({ used: sql`usage_counters.used + 1` }).where("usage_counters.used", "<", limit))
    .returning("used")
    .executeTakeFirst();
  return !!row; // geen rij teruggegeven = de update werd geweigerd door de limiet
}
