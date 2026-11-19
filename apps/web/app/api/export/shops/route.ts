import { NextResponse } from "next/server";
import { assertCan, assertWithinLimit, LimitExceededError } from "@trendscope/core";
import { getDb, sql } from "@trendscope/db";
import { getSession } from "@/lib/auth/server";
import { toCsv } from "@/lib/csv";
import { parseShopFilters, searchShops } from "@/server/queries/shops";

const MAX_ROWS = 5000;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  assertCan(session.role, "export.run");

  const db = getDb();
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  const period = periodStart.toISOString().slice(0, 10);
  try {
    const used = await db
      .selectFrom("usage_counters")
      .select("used")
      .where("workspace_id", "=", session.workspace.id)
      .where("feature", "=", "exports_per_month")
      .where("period_start", "=", period)
      .executeTakeFirst();
    assertWithinLimit(session.workspace.plan, "exports_per_month", used?.used ?? 0);
  } catch (e) {
    if (e instanceof LimitExceededError) return NextResponse.json({ error: e.message }, { status: 402 });
    throw e;
  }

  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const filters = parseShopFilters(sp);
  const rows: Awaited<ReturnType<typeof searchShops>>["rows"] = [];
  // pagina's van 25 tot het maximum (server-side, dezelfde filters als de UI)
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const res = await searchShops({ ...filters, page });
    rows.push(...res.rows);
    if (res.rows.length === 0 || rows.length >= res.total) break;
  }

  await db
    .insertInto("usage_counters")
    .values({ workspace_id: session.workspace.id, feature: "exports_per_month", period_start: period, used: 1 })
    .onConflict((oc) => oc.columns(["workspace_id", "feature", "period_start"]).doUpdateSet({ used: sql`usage_counters.used + 1` }))
    .execute();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "export.shops", metadata: JSON.stringify({ rows: rows.length, filters: sp }) }).execute();

  const csv = toCsv(
    ["domain", "name", "country", "niches", "launched_at", "monthly_visits_est", "visits_growth_pct", "live_ads", "ads_growth_30d_pct", "products"],
    rows.map((r) => [r.domain, r.name, r.country, r.niches, r.launched_at, r.monthly_visits, r.visits_growth, r.live_ads, r.ads_growth_30d, r.product_count]),
  );
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trendscope-shops-${period}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
