"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { can, PLANS } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";
import { featureEnabled } from "@/server/flags";
import { API_SCOPES, generateKey } from "@/server/api/keys";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };
const MAX_KEYS = 10;

const Create = z.object({ name: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1) });

/** Maakt een sleutel; de volledige sleutel komt alleen in dit antwoord voor en wordt nergens bewaard. */
export async function createApiKey(raw: z.input<typeof Create>): Promise<Result<{ key: string }>> {
  const session = await requireSession();
  if (!can(session.role, "api_keys.manage")) return { ok: false, error: "forbidden" };
  const p = Create.safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  // Alleen-extensie-sleutels mogen op elk plan met de flag; alle andere scopes vereisen API-toegang in het plan
  const extensionOnly = p.data.scopes.every((s) => s === "extension");
  const allowed = extensionOnly
    ? await featureEnabled("chrome_extension", session)
    : PLANS[session.workspace.plan].limits.api_access > 0 && (await featureEnabled("public_api", session));
  if (!allowed) return { ok: false, error: "plan" };
  const db = getDb();
  const { n } = await db.selectFrom("api_keys").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", session.workspace.id).where("revoked_at", "is", null).executeTakeFirstOrThrow();
  if (n >= MAX_KEYS) return { ok: false, error: "too_many" };
  const { key, prefix, hash } = generateKey();
  const row = await db
    .insertInto("api_keys")
    .values({ workspace_id: session.workspace.id, created_by: session.user.id, name: p.data.name, prefix, key_hash: hash, scopes: p.data.scopes })
    .returning("id")
    .executeTakeFirstOrThrow();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "api_keys.create", target_type: "api_key", target_id: row.id, metadata: JSON.stringify({ prefix, scopes: p.data.scopes }) }).execute();
  revalidatePath("/settings/api");
  return { ok: true, key };
}

export async function revokeApiKey(id: string): Promise<Result> {
  const session = await requireSession();
  if (!can(session.role, "api_keys.manage")) return { ok: false, error: "forbidden" };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  const res = await getDb().updateTable("api_keys").set({ revoked_at: new Date() }).where("id", "=", id).where("workspace_id", "=", session.workspace.id).where("revoked_at", "is", null).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) return { ok: false, error: "not_found" };
  await getDb().insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "api_keys.revoke", target_type: "api_key", target_id: id }).execute();
  revalidatePath("/settings/api");
  return { ok: true };
}
