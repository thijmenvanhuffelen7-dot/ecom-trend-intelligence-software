"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@trendscope/db";
import { can } from "@trendscope/core";
import { requireSession, WORKSPACE_COOKIE } from "@/lib/auth/server";

/**
 * Workspace definitief verwijderen (recht op verwijdering). Alleen de eigenaar, alleen zonder lopend betaald abonnement,
 * en alleen na het typen van de naam. Alle workspace-data verdwijnt via ON DELETE CASCADE; facturen blijven bij Stripe.
 */
export async function deleteWorkspace(form: FormData): Promise<{ ok: false; error: string } | void> {
  const session = await requireSession();
  if (!can(session.role, "workspace.delete")) return { ok: false, error: "forbidden" };
  if (String(form.get("confirm") ?? "").trim() !== session.workspace.name) return { ok: false, error: "confirm" };
  if (session.workspace.billingStatus === "active" || session.workspace.billingStatus === "past_due") return { ok: false, error: "subscription" };
  const db = getDb();
  await db.transaction().execute(async (trx) => {
    await trx.insertInto("audit_logs").values({ workspace_id: null, actor_id: session.user.id, action: "workspace.delete", target_type: "workspace", target_id: session.workspace.id, metadata: JSON.stringify({ name: session.workspace.name }) }).execute();
    await trx.deleteFrom("workspaces").where("id", "=", session.workspace.id).execute();
  });
  (await cookies()).delete(WORKSPACE_COOKIE);
  redirect("/home");
}
