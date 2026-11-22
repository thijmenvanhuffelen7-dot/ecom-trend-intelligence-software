"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { LimitExceededError } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";
import { getLocale } from "@/lib/i18n/server";
import { generateReport, type ReportKind } from "@/server/ai/reports";
import { consumeAiCredit } from "@/server/ai/usage";

export async function generateProductAi(clusterId: number, kind: ReportKind, force = false): Promise<{ ok: true } | { ok: false; error: "limit" | "failed" }> {
  const session = await requireSession();
  const id = z.number().int().positive().parse(clusterId);
  const k = z.enum(["product_report", "ad_copy"]).parse(kind);
  try {
    await consumeAiCredit(session.workspace.id, session.workspace.plan);
  } catch (e) {
    if (e instanceof LimitExceededError) return { ok: false, error: "limit" };
    throw e;
  }
  try {
    const locale = (await getLocale()) === "en" ? "en" : "nl";
    await generateReport(id, k, locale, { force });
  } catch (e) {
    console.error("ai report failed", e);
    return { ok: false, error: "failed" };
  }
  revalidatePath(`/explorer/products/${id}`);
  return { ok: true };
}

/** Gesprek verwijderen (privacy: gesprekken blijven alleen bewaard tot je ze verwijdert). Eigen gesprekken, of als beheerder. */
export async function deleteConversation(id: string): Promise<{ ok: boolean }> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(id).success) return { ok: false };
  const { getDb } = await import("@trendscope/db");
  let q = getDb().deleteFrom("ai_conversations").where("id", "=", id).where("workspace_id", "=", session.workspace.id);
  if (session.role === "member") q = q.where("user_id", "=", session.user.id);
  const res = await q.executeTakeFirst();
  revalidatePath("/assistant");
  return { ok: Number(res.numDeletedRows) > 0 };
}
