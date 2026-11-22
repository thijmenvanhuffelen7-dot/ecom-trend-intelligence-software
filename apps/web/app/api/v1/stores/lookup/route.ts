import { NextResponse } from "next/server";
import { apiError, apiJson, apiOptions, authenticate } from "@/server/api/auth";
import { normalizeDomain, storeForApi } from "@/server/api/stores";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

/** GET /api/v1/stores/lookup?domain=example.com — gebruikt door de Chrome-extensie. 404 = (nog) niet in onze database. */
export async function GET(req: Request) {
  const ctx = await authenticate(req, "read:stores", { allowExtension: true });
  if (ctx instanceof NextResponse) return ctx;
  const domain = normalizeDomain(new URL(req.url).searchParams.get("domain") ?? "");
  if (!domain) return apiError(400, "invalid_domain", "Pass a valid domain, e.g. ?domain=example.com");
  const store = await storeForApi({ domain });
  return store ? apiJson({ data: store }, ctx) : apiError(404, "not_found", `We don't track ${domain} (yet).`, ctx.headers);
}
