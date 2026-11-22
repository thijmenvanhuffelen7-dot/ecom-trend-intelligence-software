import { NextResponse } from "next/server";
import { PLANS } from "@trendscope/core";
import { apiError, apiJson, apiOptions, authenticate } from "@/server/api/auth";
import { productDetail } from "@/server/api/serialize";
import { getProduct } from "@/server/queries/products";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate(req, "read:products");
  if (ctx instanceof NextResponse) return ctx;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return apiError(400, "invalid_id", "Product id must be a positive integer.");
  const detail = await getProduct(id, ctx.workspaceId, PLANS[ctx.plan].dataWindowDays);
  if (!detail) return apiError(404, "not_found", "Product not found.");
  return apiJson({ data: productDetail(detail) }, ctx);
}
