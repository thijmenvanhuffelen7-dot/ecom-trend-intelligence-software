import { NextResponse } from "next/server";
import { can, PLANS } from "@trendscope/core";
import { getDb } from "@trendscope/db";
import { getSession } from "@/lib/auth/server";
import { toCsv } from "@/lib/csv";
import { LEAD_COLUMNS, parseLeadFilters, reserveLeads, searchLeads } from "@/server/queries/leads";

export const dynamic = "force-dynamic";
const MAX_ROWS = 5000;

/** CSV met B2B-leads. Neemt de filters van de Shop Explorer over (niche, origin → land, platform) en telt per rij. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(session.role, "export.run")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (PLANS[session.workspace.plan].limits.leads_export <= 0) return NextResponse.json({ error: "plan" }, { status: 402 });
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = parseLeadFilters({ niche: sp.niche, country: sp.origin ?? sp.country, platform: sp.platform, min_visits: sp.min_visits, has_ads: sp.has_ads, app: sp.app });
  const rows: Awaited<ReturnType<typeof searchLeads>>["rows"] = [];
  for (let offset = 0; rows.length < MAX_ROWS; offset += 1000) {
    const page = await searchLeads({ ...f, limit: 1000, offset });
    rows.push(...page.rows);
    if (page.rows.length < 1000) break;
  }
  const granted = await reserveLeads(session.workspace.id, session.workspace.plan, Math.min(rows.length, MAX_ROWS));
  if (rows.length && !granted) return NextResponse.json({ error: "quota_exceeded" }, { status: 402 });
  const out = rows.slice(0, granted);
  await getDb().insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "export.leads", metadata: JSON.stringify({ rows: out.length, filters: sp }) }).execute();
  const csv = toCsv([...LEAD_COLUMNS], out.map((r) => LEAD_COLUMNS.map((k) => r[k])));
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="trendscope-leads-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
