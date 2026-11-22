import { NextResponse } from "next/server";
import { apiError, apiJson, apiOptions, authenticate, searchParamsOf } from "@/server/api/auth";
import { parseLeadFilters, reserveLeads, searchLeads } from "@/server/queries/leads";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/leads — zakelijke winkelgegevens; elke geleverde rij telt mee voor het maandquotum `leads_export`. */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "read:leads");
  if (ctx instanceof NextResponse) return ctx;
  const f = parseLeadFilters(searchParamsOf(req));
  const { total, rows } = await searchLeads(f);
  const granted = await reserveLeads(ctx.workspaceId, ctx.plan, rows.length);
  if (rows.length > 0 && granted === 0) return apiError(429, "quota_exceeded", "Monthly leads quota for this plan is used up.", ctx.headers);
  return apiJson({ data: rows.slice(0, granted), total, offset: f.offset, truncated: granted < rows.length }, ctx);
}
