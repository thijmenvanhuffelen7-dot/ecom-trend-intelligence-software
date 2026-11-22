"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { FlagKeySchema, FlagRolloutSchema, PLAN_IDS } from "@trendscope/core";
import { requireSession, type Session } from "@/lib/auth/server";
import { WEIGHT_SIGNALS as SIGNALS } from "@/lib/admin";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

/** Alleen platformbeheerders; elke wijziging komt in de audit log (zonder workspace: platformniveau). */
async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) throw new Error("forbidden");
  return session;
}

async function audit(session: Session, action: string, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  await getDb()
    .insertInto("audit_logs")
    .values({ workspace_id: null, actor_id: session.user.id, action, target_type: targetType, target_id: targetId, metadata: JSON.stringify(metadata) })
    .execute();
}

// ── Gebruikers en workspaces ────────────────────────────────────────────────────────────────────
const PlanOverride = z.object({ workspaceId: z.string().uuid(), plan: z.enum(PLAN_IDS) });

/** Handmatige planwijziging (support, partners, demo's). Stripe blijft leidend zodra er een abonnement is. */
export async function overrideWorkspacePlan(raw: z.input<typeof PlanOverride>): Promise<Result> {
  const session = await requireAdmin();
  const p = PlanOverride.safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  const db = getDb();
  const ws = await db.selectFrom("workspaces").select(["plan", "billing_status"]).where("id", "=", p.data.workspaceId).executeTakeFirst();
  if (!ws) return { ok: false, error: "not_found" };
  await db
    .updateTable("workspaces")
    .set({
      plan: p.data.plan,
      // Een handmatig plan zonder Stripe-abonnement markeren we als 'demo' zodat het niet als betaald telt
      billing_status: ws.billing_status === "active" || ws.billing_status === "past_due" ? ws.billing_status : p.data.plan === "free" ? "none" : "demo",
      trial_ends_at: null,
      updated_at: new Date(),
    })
    .where("id", "=", p.data.workspaceId)
    .execute();
  await audit(session, "admin.plan_override", "workspace", p.data.workspaceId, { from: ws.plan, to: p.data.plan });
  revalidatePath("/admin");
  return { ok: true };
}

export async function setPlatformAdmin(raw: { userId: string; value: boolean }): Promise<Result> {
  const session = await requireAdmin();
  const p = z.object({ userId: z.string().uuid(), value: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  if (p.data.userId === session.user.id && !p.data.value) return { ok: false, error: "self" }; // jezelf niet buitensluiten
  await getDb().updateTable("users").set({ is_platform_admin: p.data.value, updated_at: new Date() }).where("id", "=", p.data.userId).execute();
  await audit(session, p.data.value ? "admin.grant_admin" : "admin.revoke_admin", "user", p.data.userId);
  revalidatePath("/admin");
  return { ok: true };
}

// ── Scoregewichten ──────────────────────────────────────────────────────────────────────────────
const Weights = z.object({
  weights: z.record(z.enum(SIGNALS), z.number().min(0).max(5)),
  note: z.string().trim().max(200).optional(),
  activate: z.boolean().default(false),
});

/** Gewichten zijn geversioneerd: een wijziging maakt altijd een nieuwe versie; scores verwijzen naar hun versie. */
export async function createWeightsVersion(raw: z.input<typeof Weights>): Promise<Result<{ version: number }>> {
  const session = await requireAdmin();
  const p = Weights.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "invalid" };
  if (Object.values(p.data.weights).every((v) => v === 0)) return { ok: false, error: "all_zero" };
  const db = getDb();
  const version = await db.transaction().execute(async (trx) => {
    const active = await trx.selectFrom("score_weights").select(["weights", "params"]).where("is_active", "=", true).forUpdate().executeTakeFirst();
    const { next } = await trx.selectFrom("score_weights").select(sql<number>`coalesce(max(version), 0) + 1`.as("next")).executeTakeFirstOrThrow();
    // Onbekende/weggelaten signalen houden de waarde van de actieve versie
    const merged = { ...((active?.weights ?? {}) as Record<string, number>), ...p.data.weights };
    if (p.data.activate) await trx.updateTable("score_weights").set({ is_active: false }).where("is_active", "=", true).execute();
    await trx
      .insertInto("score_weights")
      .values({ version: next, weights: JSON.stringify(merged), params: JSON.stringify(active?.params ?? {}), is_active: p.data.activate, note: p.data.note || null, created_by: session.user.id })
      .execute();
    return next;
  });
  await audit(session, "admin.weights_create", "score_weights", String(version), { activate: p.data.activate });
  revalidatePath("/admin");
  return { ok: true, version };
}

export async function activateWeightsVersion(version: number): Promise<Result> {
  const session = await requireAdmin();
  if (!Number.isInteger(version) || version < 1) return { ok: false, error: "invalid" };
  const db = getDb();
  const found = await db.transaction().execute(async (trx) => {
    const row = await trx.selectFrom("score_weights").select("version").where("version", "=", version).executeTakeFirst();
    if (!row) return false;
    await trx.updateTable("score_weights").set({ is_active: false }).where("is_active", "=", true).execute();
    await trx.updateTable("score_weights").set({ is_active: true }).where("version", "=", version).execute();
    return true;
  });
  if (!found) return { ok: false, error: "not_found" };
  await audit(session, "admin.weights_activate", "score_weights", String(version));
  revalidatePath("/admin");
  return { ok: true };
}

// ── Feature flags ───────────────────────────────────────────────────────────────────────────────
const Flag = z.object({
  key: FlagKeySchema,
  description: z.string().trim().max(200).optional(),
  enabled: z.boolean(),
  rollout: FlagRolloutSchema,
});

export async function saveFeatureFlag(raw: z.input<typeof Flag>): Promise<Result> {
  const session = await requireAdmin();
  const p = Flag.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "invalid" };
  const values = { key: p.data.key, description: p.data.description || null, enabled: p.data.enabled, rollout: JSON.stringify(p.data.rollout), updated_at: new Date() };
  await getDb()
    .insertInto("feature_flags")
    .values(values)
    .onConflict((oc) => oc.column("key").doUpdateSet({ description: values.description, enabled: values.enabled, rollout: values.rollout, updated_at: values.updated_at }))
    .execute();
  await audit(session, "admin.flag_save", "feature_flag", p.data.key, { enabled: p.data.enabled, percent: p.data.rollout.percent });
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteFeatureFlag(key: string): Promise<Result> {
  const session = await requireAdmin();
  if (!FlagKeySchema.safeParse(key).success) return { ok: false, error: "invalid" };
  await getDb().deleteFrom("feature_flags").where("key", "=", key).execute();
  await audit(session, "admin.flag_delete", "feature_flag", key);
  revalidatePath("/admin");
  return { ok: true };
}

// ── Curatie ─────────────────────────────────────────────────────────────────────────────────────
/** "Winning products" die het team handmatig uitlicht (filter `curated` in de explorer, badge op de kaart). */
export async function setCurated(raw: { clusterId: number; value: boolean }): Promise<Result> {
  const session = await requireAdmin();
  const p = z.object({ clusterId: z.number().int().positive(), value: z.boolean() }).safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid" };
  const res = await getDb().updateTable("product_clusters").set({ is_curated: p.data.value }).where("id", "=", String(p.data.clusterId)).executeTakeFirst();
  if (!Number(res.numUpdatedRows)) return { ok: false, error: "not_found" };
  await audit(session, p.data.value ? "admin.curate" : "admin.uncurate", "product_cluster", String(p.data.clusterId));
  revalidatePath("/admin");
  revalidatePath("/explorer/products");
  return { ok: true };
}
