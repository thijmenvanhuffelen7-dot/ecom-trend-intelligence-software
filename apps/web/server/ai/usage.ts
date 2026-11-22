import "server-only";
import { getDb, sql } from "@trendscope/db";
import { assertWithinLimit, type PlanId } from "@trendscope/core";

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
};

/** Controleert de planlimiet (per maand) en telt het gebruik op. Gooit LimitExceededError bij overschrijding. */
export async function consumeAiCredit(workspaceId: string, plan: PlanId, feature: "ai_assistant" = "ai_assistant") {
  const db = getDb();
  const period = monthStart();
  const row = await db.selectFrom("usage_counters").select("used").where("workspace_id", "=", workspaceId).where("feature", "=", feature).where("period_start", "=", period).executeTakeFirst();
  assertWithinLimit(plan, feature, row?.used ?? 0);
  await db
    .insertInto("usage_counters")
    .values({ workspace_id: workspaceId, feature, period_start: period, used: 1 })
    .onConflict((oc) => oc.columns(["workspace_id", "feature", "period_start"]).doUpdateSet({ used: sql`usage_counters.used + 1` }))
    .execute();
}
