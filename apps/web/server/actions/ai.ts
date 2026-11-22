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
