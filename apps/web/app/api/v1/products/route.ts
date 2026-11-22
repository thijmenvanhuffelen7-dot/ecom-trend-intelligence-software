import { NextResponse } from "next/server";
import { apiJson, apiOptions, authenticate, searchParamsOf } from "@/server/api/auth";
import { productSummary } from "@/server/api/serialize";
import { parseProductFilters, PRODUCT_PAGE_SIZE, searchProducts } from "@/server/queries/products";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/products — dezelfde filters als de productexplorer (q, niche, phase, minval, maxsat, price, source, sort, page). */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "read:products");
  if (ctx instanceof NextResponse) return ctx;
  const f = parseProductFilters(searchParamsOf(req));
  const { total, rows } = await searchProducts(f);
  return apiJson({ data: rows.map(productSummary), page: f.page, page_size: PRODUCT_PAGE_SIZE, total }, ctx);
}
