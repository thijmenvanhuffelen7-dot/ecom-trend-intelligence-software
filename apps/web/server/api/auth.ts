import "server-only";
import { NextResponse } from "next/server";
import { getDb, sql } from "@trendscope/db";
import { flagEnabledFor, PLANS, type PlanId } from "@trendscope/core";
import { hashesEqual, hashKey, parseKey, type ApiScope } from "./keys";

/** Verzoeken per minuut per sleutel (vast venster). Het maandquotum komt uit het plan (`api_access`). */
export const API_RATE_PER_MINUTE = 120;

export interface ApiContext {
  keyId: string;
  workspaceId: string;
  plan: PlanId;
  headers: Record<string, string>;
}

/** Bearer-auth zonder cookies, dus CORS mag open (o.a. voor de Chrome-extensie). */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...headers } });
}

export function apiJson(data: unknown, ctx: ApiContext, status = 200) {
  return NextResponse.json(data, { status, headers: { ...CORS_HEADERS, "Cache-Control": "no-store", ...ctx.headers } });
}

export function apiOptions() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Controleert sleutel, scope, plan en feature flag; telt daarna het verzoek mee voor de minuutlimiet en het maandquotum.
 * Volgorde is bewust: een ongeldige sleutel kost niets, een geweigerd verzoek telt niet mee voor het quotum.
 */
/**
 * `scope: null` = elke geldige sleutel (voor /me). `allowExtension`: ook sleutels met alleen de scope `extension`
 * (winkel-lookup voor de Chrome-extensie) — die vallen buiten het API-plan en -quotum, wel onder de minuutlimiet.
 */
export async function authenticate(req: Request, scope: ApiScope | null, opts: { allowExtension?: boolean } = {}): Promise<ApiContext | NextResponse> {
  const parsed = parseKey(req.headers.get("authorization"));
  if (!parsed) return apiError(401, "unauthorized", "Missing or malformed API key. Use: Authorization: Bearer ts_live_…");
  const db = getDb();
  const row = await db
    .selectFrom("api_keys as k")
    .innerJoin("workspaces as w", "w.id", "k.workspace_id")
    .select(["k.id", "k.key_hash", "k.scopes", "k.revoked_at", "k.last_used_at", "w.id as workspace_id", "w.plan"])
    .where("k.prefix", "=", parsed.prefix)
    .executeTakeFirst();
  if (!row || row.revoked_at || !hashesEqual(hashKey(parsed.key), row.key_hash)) return apiError(401, "unauthorized", "Invalid or revoked API key.");
  const viaExtension = !!opts.allowExtension && row.scopes.includes("extension") && !(scope && row.scopes.includes(scope));
  if (scope && !viaExtension && !row.scopes.includes(scope)) return apiError(403, "insufficient_scope", `This key lacks the scope ${scope}.`);

  const plan = row.plan as PlanId;
  const quota = PLANS[plan].limits.api_access;
  const cap = Number.isFinite(quota) ? quota : 2_147_483_647;
  const flag = await db.selectFrom("feature_flags").select(["key", "enabled", "rollout"]).where("key", "=", viaExtension ? "chrome_extension" : "public_api").executeTakeFirst();
  if (!flagEnabledFor(flag, { id: row.workspace_id, plan })) return apiError(403, "plan", viaExtension ? "The browser extension is not enabled for this workspace." : "API access is not included in this workspace's plan.");
  if (!viaExtension && quota <= 0) return apiError(403, "plan", "API access is not included in this workspace's plan.");

  // Minuutvenster: atomair ophogen; boven de limiet weigeren met Retry-After
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const reset = Math.ceil((windowStart.getTime() + 60_000) / 1000);
  const { count } = await db
    .insertInto("api_rate_windows")
    .values({ key_id: row.id, window_start: windowStart, count: 1 })
    .onConflict((oc) => oc.columns(["key_id", "window_start"]).doUpdateSet({ count: sql`api_rate_windows.count + 1` }))
    .returning("count")
    .executeTakeFirstOrThrow();
  const rateHeaders = {
    "X-RateLimit-Limit": String(API_RATE_PER_MINUTE),
    "X-RateLimit-Remaining": String(Math.max(0, API_RATE_PER_MINUTE - count)),
    "X-RateLimit-Reset": String(reset),
  };
  if (count > API_RATE_PER_MINUTE) {
    return apiError(429, "rate_limited", `More than ${API_RATE_PER_MINUTE} requests per minute.`, { ...rateHeaders, "Retry-After": String(Math.max(1, reset - Math.floor(now.getTime() / 1000))) });
  }

  if (viaExtension) {
    if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > 60_000) await db.updateTable("api_keys").set({ last_used_at: now }).where("id", "=", row.id).execute();
    return { keyId: row.id, workspaceId: row.workspace_id, plan, headers: rateHeaders };
  }

  // Maandquotum (zelfde tellers als de rest van de app); alleen ophogen zolang er ruimte is
  const month = `${now.toISOString().slice(0, 7)}-01`;
  const used = await db
    .insertInto("usage_counters")
    .values({ workspace_id: row.workspace_id, feature: "api_access", period_start: month, used: 1 })
    .onConflict((oc) => oc.columns(["workspace_id", "feature", "period_start"]).doUpdateSet({ used: sql`usage_counters.used + 1` }).where("usage_counters.used", "<", cap))
    .returning("used")
    .executeTakeFirst();
  if (!used) return apiError(429, "quota_exceeded", "Monthly API quota for this plan is used up.", rateHeaders);

  // last_used_at hooguit eens per minuut bijwerken (scheelt schrijfacties)
  if (!row.last_used_at || now.getTime() - new Date(row.last_used_at).getTime() > 60_000) {
    await db.updateTable("api_keys").set({ last_used_at: now }).where("id", "=", row.id).execute();
  }
  // Oude vensters opruimen (af en toe, goedkoop)
  if (Math.random() < 0.01) await db.deleteFrom("api_rate_windows").where("window_start", "<", new Date(now.getTime() - 3_600_000)).execute();

  return {
    keyId: row.id,
    workspaceId: row.workspace_id,
    plan,
    headers: { ...rateHeaders, "X-Quota-Limit": String(cap), "X-Quota-Remaining": String(Math.max(0, cap - used.used)) },
  };
}

/** Querystring → het SearchParams-formaat van de app, zodat de API dezelfde filters gebruikt als de explorer. */
export function searchParamsOf(req: Request): Record<string, string> {
  return Object.fromEntries(new URL(req.url).searchParams.entries());
}
