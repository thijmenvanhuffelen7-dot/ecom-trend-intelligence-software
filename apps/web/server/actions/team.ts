"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Kysely } from "kysely";
import { getDb, sql, type DB } from "@trendscope/db";
import { assertCan, ForbiddenError, PLANS, type PlanId } from "@trendscope/core";
import { requireSession, WORKSPACE_COOKIE } from "@/lib/auth/server";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const hashToken = async (token: string) => createHash("sha256").update(token).digest("hex");

/** Seats = leden + openstaande uitnodigingen; zo kun je de limiet niet omzeilen door veel tegelijk uit te nodigen. */
async function seatsInUse(db: Kysely<DB>, workspaceId: string): Promise<number> {
  const { n } = await db
    .selectNoFrom([
      sql<number>`(select count(*)::int from memberships where workspace_id = ${workspaceId})
        + (select count(*)::int from workspace_invitations where workspace_id = ${workspaceId} and accepted_at is null and revoked_at is null and expires_at > now())`.as("n"),
    ])
    .executeTakeFirstOrThrow();
  return n;
}

const Invite = z.object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(["admin", "member"]).default("member") });

export async function inviteMember(raw: z.input<typeof Invite>): Promise<Result<{ link: string }>> {
  const session = await requireSession();
  try {
    assertCan(session.role, "members.invite");
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: "forbidden" };
    throw e;
  }
  const p = Invite.safeParse(raw);
  if (!p.success) return { ok: false, error: "invalid_email" };
  const db = getDb();
  const ws = session.workspace;
  const already = await db
    .selectFrom("memberships as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select("u.id")
    .where("m.workspace_id", "=", ws.id)
    .where("u.email", "=", p.data.email)
    .executeTakeFirst();
  if (already) return { ok: false, error: "already_member" };

  const token = randomBytes(24).toString("base64url");
  const link = `${appUrl()}/invite/${token}`;
  try {
    await db.transaction().execute(async (trx) => {
      // Serialiseer per workspace zodat twee gelijktijdige uitnodigingen samen de limiet niet overschrijden
      await sql`select pg_advisory_xact_lock(hashtext(${`invite:${ws.id}`}))`.execute(trx);
      // Een eerdere openstaande uitnodiging voor hetzelfde adres vervangen we (nieuwe link)
      await trx.updateTable("workspace_invitations").set({ revoked_at: new Date() }).where("workspace_id", "=", ws.id).where("email", "=", p.data.email).where("accepted_at", "is", null).where("revoked_at", "is", null).execute();
      if ((await seatsInUse(trx, ws.id)) >= PLANS[ws.plan].limits.seats) throw new Error("limit");
      await trx
        .insertInto("workspace_invitations")
        .values({ workspace_id: ws.id, email: p.data.email, role: p.data.role, token_hash: await hashToken(token), invited_by: session.user.id })
        .execute();
      await trx
        .insertInto("outbound_emails")
        .values({
          kind: "invite",
          to_address: p.data.email,
          subject: `${session.user.email} nodigt je uit voor ${ws.name} op Trendscope`,
          html: `<p>${escapeHtml(session.user.email)} heeft je uitgenodigd voor de workspace <strong>${escapeHtml(ws.name)}</strong> op Trendscope.</p>
<p><a href="${link}">Uitnodiging accepteren</a> (geldig tot 7 dagen).</p>
<p style="color:#666">Verwachtte je deze uitnodiging niet? Dan kun je deze e-mail negeren.</p>`,
        })
        .execute();
      await trx.insertInto("audit_logs").values({ workspace_id: ws.id, actor_id: session.user.id, action: "members.invite", target_type: "invitation", target_id: p.data.email }).execute();
    });
  } catch (e) {
    if (e instanceof Error && e.message === "limit") return { ok: false, error: "limit" };
    throw e;
  }
  revalidatePath("/settings");
  // De link tonen we ook direct aan de uitnodiger (handig zonder mailprovider; de mail gaat via de worker)
  return { ok: true, link };
}

export async function revokeInvite(id: string): Promise<Result> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "invalid" };
  try {
    assertCan(session.role, "members.invite");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  await getDb().updateTable("workspace_invitations").set({ revoked_at: new Date() }).where("id", "=", id).where("workspace_id", "=", session.workspace.id).where("accepted_at", "is", null).execute();
  revalidatePath("/settings");
  return { ok: true };
}

export async function removeMember(userId: string): Promise<Result> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(userId).success) return { ok: false, error: "invalid" };
  try {
    assertCan(session.role, "members.remove");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (userId === session.user.id) return { ok: false, error: "self" };
  const db = getDb();
  const target = await db.selectFrom("memberships").select("role").where("workspace_id", "=", session.workspace.id).where("user_id", "=", userId).executeTakeFirst();
  if (!target) return { ok: false, error: "not_found" };
  if (target.role === "owner") return { ok: false, error: "owner" }; // de eigenaar verwijder je niet
  if (target.role === "admin" && session.role !== "owner") return { ok: false, error: "forbidden" };
  await db.deleteFrom("memberships").where("workspace_id", "=", session.workspace.id).where("user_id", "=", userId).execute();
  await db.insertInto("audit_logs").values({ workspace_id: session.workspace.id, actor_id: session.user.id, action: "members.remove", target_type: "user", target_id: userId }).execute();
  revalidatePath("/settings");
  return { ok: true };
}

async function setWorkspaceCookie(id: string) {
  (await cookies()).set(WORKSPACE_COOKIE, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
}

export async function switchWorkspace(workspaceId: string): Promise<void> {
  const session = await requireSession();
  if (!z.string().uuid().safeParse(workspaceId).success) return;
  const member = await getDb().selectFrom("memberships").select("workspace_id").where("user_id", "=", session.user.id).where("workspace_id", "=", workspaceId).executeTakeFirst();
  if (member) await setWorkspaceCookie(workspaceId);
  redirect("/home");
}

/**
 * Uitnodiging accepteren: alleen met het e-mailadres waarvoor ze bedoeld is, niet verlopen of ingetrokken,
 * en alleen als het plan van die workspace nog plek heeft (de uitnodiging telde al mee als seat).
 */
export async function acceptInvite(token: string): Promise<Result> {
  const session = await requireSession();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, error: "invalid" };
  const db = getDb();
  const hash = await hashToken(token);
  const outcome = await db.transaction().execute(async (trx): Promise<Result<{ workspaceId: string }>> => {
    const inv = await trx
      .selectFrom("workspace_invitations as i")
      .innerJoin("workspaces as w", "w.id", "i.workspace_id")
      .select(["i.id", "i.workspace_id", "i.email", "i.role", "i.expires_at", "i.accepted_at", "i.revoked_at", "w.plan"])
      .where("i.token_hash", "=", hash)
      .forUpdate("i")
      .executeTakeFirst();
    if (!inv || inv.revoked_at) return { ok: false, error: "invalid" };
    if (inv.accepted_at) return { ok: false, error: "used" };
    if (new Date(inv.expires_at) < new Date()) return { ok: false, error: "expired" };
    if (inv.email !== session.user.email.toLowerCase()) return { ok: false, error: "wrong_email" };
    const { n } = await trx.selectFrom("memberships").select(sql<number>`count(*)::int`.as("n")).where("workspace_id", "=", inv.workspace_id).executeTakeFirstOrThrow();
    if (n >= PLANS[inv.plan as PlanId].limits.seats) return { ok: false, error: "limit" }; // plan is intussen verlaagd
    await trx
      .insertInto("memberships")
      .values({ workspace_id: inv.workspace_id, user_id: session.user.id, role: inv.role })
      .onConflict((oc) => oc.columns(["workspace_id", "user_id"]).doNothing())
      .execute();
    await trx.updateTable("workspace_invitations").set({ accepted_at: new Date() }).where("id", "=", inv.id).execute();
    await trx.insertInto("audit_logs").values({ workspace_id: inv.workspace_id, actor_id: session.user.id, action: "members.join", target_type: "invitation", target_id: inv.id }).execute();
    return { ok: true, workspaceId: inv.workspace_id };
  });
  if (!outcome.ok) return outcome;
  await setWorkspaceCookie(outcome.workspaceId);
  redirect("/home");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
