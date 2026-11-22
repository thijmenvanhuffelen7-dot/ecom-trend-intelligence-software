import { NextResponse } from "next/server";
import { apiError, apiJson, apiOptions, authenticate } from "@/server/api/auth";
import { storeForApi } from "@/server/api/stores";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticate(req, "read:stores");
  if (ctx instanceof NextResponse) return ctx;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) return apiError(400, "invalid_id", "Store id must be a positive integer. Use /api/v1/stores/lookup?domain= for domains.");
  const store = await storeForApi({ id });
  return store ? apiJson({ data: store }, ctx) : apiError(404, "not_found", "Store not found.");
}
