import { NextResponse } from "next/server";
import { apiJson, apiOptions, authenticate, searchParamsOf } from "@/server/api/auth";
import { trendSummary } from "@/server/api/serialize";
import { parseTrendFilters, searchTrends } from "@/server/queries/trends";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/trends — zoektermen of hashtags (kind), per land en periode, met fase, groei en gekoppeld product. */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "read:trends");
  if (ctx instanceof NextResponse) return ctx;
  const sp = searchParamsOf(req);
  const f = parseTrendFilters(sp);
  const limit = Math.min(200, Math.max(1, Number(sp.limit) || 50));
  const rows = await searchTrends(f);
  return apiJson({ data: rows.slice(0, limit).map(trendSummary), total: rows.length, country: f.kind === "hashtag" ? "ALL" : f.country, period_days: Number(f.period) }, ctx);
}
