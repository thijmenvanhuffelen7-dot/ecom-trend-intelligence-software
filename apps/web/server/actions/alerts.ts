"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb, sql } from "@trendscope/db";
import { AlertRuleSchema, assertCan, assertWithinLimit, ChannelConfigSchema, LimitExceededError, maskChannel } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";
import { encryptJson } from "@/lib/crypto";
import { evaluateWorkspace } from "@/server/alerts/evaluate";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

async function audit(workspaceId: string, userId: string, action: string, target: string) {
  await getDb().insertInto("audit_logs").values({ workspace_id: workspaceId, actor_id: userId, action, target_type: "alert", target_id: target }).execute().catch(() => undefined);
}

const CreateRule = z.object({
  name: z.string().trim().min(2).max(80),
  rule: AlertRuleSchema,
  channels: z.array(z.string().uuid()).max(5).default([]),
  cooldownHours: z.number().int().min(1).max(720).default(24),
});

export async function createAlertRule(raw: z.input<typeof CreateRule>): Promise<Result<{ id: string }>> {
  const session = await requireSession();
  assertCan(session.role, "alerts.write");
  const parsed = CreateRule.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  const db = getDb();
  const { n } = await db.selectFrom("alert_rules").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", session.workspace.id).executeTakeFirstOrThrow();
  try {
    assertWithinLimit(session.workspace.plan, "alerts", n);
  } catch (e) {
    if (e instanceof LimitExceededError) return { ok: false, error: "limit" };
    throw e;
  }
  // Alleen kanalen van de eigen workspace
  const owned = parsed.data.channels.length
    ? (await db.selectFrom("notification_channels").select("id").where("workspace_id", "=", session.workspace.id).where("id", "in", parsed.data.channels).execute()).map((c) => c.id)
    : [];
  const row = await db
    .insertInto("alert_rules")
    .values({
      workspace_id: session.workspace.id,
      name: parsed.data.name,
      rule: JSON.stringify(parsed.data.rule),
      channels: JSON.stringify(owned),
      cooldown_hours: parsed.data.cooldownHours,
      created_by: session.user.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await audit(session.workspace.id, session.user.id, "alert_rule.create", row.id);
  revalidatePath("/alerts");
  return { ok: true, id: row.id };
}

export async function toggleAlertRule(id: string, enabled: boolean): Promise<Result> {
  const session = await requireSession();
  assertCan(session.role, "alerts.write");
  await getDb().updateTable("alert_rules").set({ enabled }).where("id", "=", z.string().uuid().parse(id)).where("workspace_id", "=", session.workspace.id).execute();
  revalidatePath("/alerts");
  return { ok: true };
}

export async function deleteAlertRule(id: string): Promise<Result> {
  const session = await requireSession();
  assertCan(session.role, "alerts.write");
  await getDb().deleteFrom("alert_rules").where("id", "=", z.string().uuid().parse(id)).where("workspace_id", "=", session.workspace.id).execute();
  await audit(session.workspace.id, session.user.id, "alert_rule.delete", id);
  revalidatePath("/alerts");
  return { ok: true };
}

/** "Nu controleren": evalueert direct, in plaats van te wachten op de volgende cron-ronde. */
export async function evaluateNow(): Promise<Result<{ events: number }>> {
  const session = await requireSession();
  const { events } = await evaluateWorkspace(session.workspace.id);
  revalidatePath("/alerts");
  return { ok: true, events };
}

export async function markAlertsRead(): Promise<Result> {
  const session = await requireSession();
  await getDb().updateTable("alert_events").set({ read_at: new Date() }).where("workspace_id", "=", session.workspace.id).where("read_at", "is", null).execute();
  revalidatePath("/alerts");
  return { ok: true };
}

const CreateChannel = z.object({ name: z.string().trim().min(2).max(60), config: ChannelConfigSchema });

export async function createChannel(raw: z.input<typeof CreateChannel>): Promise<Result<{ id: string }>> {
  const session = await requireSession();
  assertCan(session.role, "alerts.write");
  const parsed = CreateChannel.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalid" };
  const row = await getDb()
    .insertInto("notification_channels")
    .values({
      workspace_id: session.workspace.id,
      type: parsed.data.config.type,
      name: parsed.data.name,
      config_enc: encryptJson(parsed.data.config),
      target_hint: maskChannel(parsed.data.config),
      created_by: session.user.id,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  await audit(session.workspace.id, session.user.id, "channel.create", row.id);
  revalidatePath("/alerts");
  return { ok: true, id: row.id };
}

export async function deleteChannel(id: string): Promise<Result> {
  const session = await requireSession();
  assertCan(session.role, "alerts.write");
  await getDb().deleteFrom("notification_channels").where("id", "=", z.string().uuid().parse(id)).where("workspace_id", "=", session.workspace.id).execute();
  await audit(session.workspace.id, session.user.id, "channel.delete", id);
  revalidatePath("/alerts");
  return { ok: true };
}

export async function setDigest(value: "off" | "daily" | "weekly"): Promise<Result> {
  const session = await requireSession();
  await getDb().updateTable("users").set({ digest: z.enum(["off", "daily", "weekly"]).parse(value) }).where("id", "=", session.user.id).execute();
  revalidatePath("/alerts");
  return { ok: true };
}
