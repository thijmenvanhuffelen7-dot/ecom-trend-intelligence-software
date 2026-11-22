import { NextResponse } from "next/server";
import { apiJson, apiOptions, authenticate, searchParamsOf } from "@/server/api/auth";
import { storeSummary } from "@/server/api/serialize";
import { PAGE_SIZE, parseShopFilters, searchShops } from "@/server/queries/shops";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/stores — dezelfde filters als de Shop Explorer (q, niche, origin, vc, traffic, platform, apps, ads, sort, page …). */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "read:stores");
  if (ctx instanceof NextResponse) return ctx;
  const f = parseShopFilters(searchParamsOf(req));
  const { total, rows } = await searchShops(f);
  return apiJson({ data: rows.map(storeSummary), page: f.page, page_size: PAGE_SIZE, total }, ctx);
}
