import { NextResponse } from "next/server";
import { getDb } from "@trendscope/db";
import { apiJson, apiOptions, authenticate } from "@/server/api/auth";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/me — controleert een sleutel: workspace, plan, scopes en quota (zie ook de X-RateLimit-/X-Quota-headers). */
export async function GET(req: Request) {
  const res = await authenticate(req, null, { allowExtension: true });
  if (res instanceof NextResponse) return res;
  const key = await getDb()
    .selectFrom("api_keys as k")
    .innerJoin("workspaces as w", "w.id", "k.workspace_id")
    .select(["k.name", "k.prefix", "k.scopes", "k.created_at", "w.name as workspace", "w.plan"])
    .where("k.id", "=", res.keyId)
    .executeTakeFirstOrThrow();
  return apiJson({ data: { key: { name: key.name, prefix: key.prefix, scopes: key.scopes, created_at: key.created_at }, workspace: { name: key.workspace, plan: key.plan } } }, res);
}
