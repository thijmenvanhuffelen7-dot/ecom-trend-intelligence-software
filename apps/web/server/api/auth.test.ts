/** Integratie (RUN_INTEGRATION=1): sleutelcontrole, minuutlimiet, maandquotum en extensiesleutels tegen de echte database. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextResponse } from "next/server";

const run = !!process.env.RUN_INTEGRATION && !!process.env.DATABASE_URL;

describe.skipIf(!run)("api authenticate", async () => {
  const { getDb } = await import("@trendscope/db");
  const { authenticate, API_RATE_PER_MINUTE } = await import("./auth");
  const { generateKey } = await import("./keys");
  const db = getDb();
  const ids: string[] = [];

  async function workspace(plan: "pro" | "business", scopes: string[]) {
    const ws = await db.insertInto("workspaces").values({ name: "API test", slug: `api-${randomUUID().slice(0, 8)}`, plan }).returning("id").executeTakeFirstOrThrow();
    ids.push(ws.id);
    const k = generateKey();
    await db.insertInto("api_keys").values({ workspace_id: ws.id, name: "t", prefix: k.prefix, key_hash: k.hash, scopes }).execute();
    return { wsId: ws.id, req: () => new Request("http://x/api/v1/products", { headers: { authorization: `Bearer ${k.key}` } }) };
  }
  const status = (r: unknown) => (r instanceof NextResponse ? r.status : 200);
  const code = async (r: unknown) => (r instanceof NextResponse ? ((await r.json()) as { error: { code: string } }).error.code : "ok");

  beforeAll(async () => {
    await db.insertInto("feature_flags").values([
      { key: "public_api", enabled: true, rollout: JSON.stringify({ percent: 100, plans: ["business"] }) },
      { key: "chrome_extension", enabled: true, rollout: JSON.stringify({ percent: 100 }) },
    ]).onConflict((oc) => oc.column("key").doNothing()).execute();
  });
  afterAll(async () => {
    if (ids.length) await db.deleteFrom("workspaces").where("id", "in", ids).execute();
    await db.destroy();
  });

  it("enforces the per-minute window", async () => {
    const { req } = await workspace("business", ["read:products"]);
    // Venstergrens vermijden: wacht tot er minstens 10 s over is in deze minuut
    const left = 60_000 - (Date.now() % 60_000);
    if (left < 10_000) await new Promise((r) => setTimeout(r, left + 50));
    for (let i = 0; i < API_RATE_PER_MINUTE; i++) expect(status(await authenticate(req(), "read:products"))).toBe(200);
    const over = await authenticate(req(), "read:products");
    expect(status(over)).toBe(429);
    expect((over as NextResponse).headers.get("retry-after")).toMatch(/^\d+$/);
  }, 60_000);

  it("enforces scopes, plan and the monthly quota", async () => {
    const pro = await workspace("pro", ["read:products"]);
    expect(await code(await authenticate(pro.req(), "read:products"))).toBe("plan");
    const biz = await workspace("business", ["read:products"]);
    expect(await code(await authenticate(biz.req(), "read:leads"))).toBe("insufficient_scope");
    await db.insertInto("usage_counters").values({ workspace_id: biz.wsId, feature: "api_access", period_start: `${new Date().toISOString().slice(0, 7)}-01`, used: 100_000 }).execute();
    expect(await code(await authenticate(biz.req(), "read:products"))).toBe("quota_exceeded");
  });

  it("extension keys: lookup only, any plan, outside the API quota", async () => {
    const ext = await workspace("pro", ["extension"]);
    expect(await code(await authenticate(ext.req(), "read:stores"))).toBe("insufficient_scope");
    expect(status(await authenticate(ext.req(), "read:stores", { allowExtension: true }))).toBe(200);
    const used = await db.selectFrom("usage_counters").select("used").where("workspace_id", "=", ext.wsId).where("feature", "=", "api_access").executeTakeFirst();
    expect(used).toBeUndefined();
  });
});
