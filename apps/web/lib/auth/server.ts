import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb, sql } from "@trendscope/db";
import type { PlanId, Role } from "@trendscope/core";
import { SESSION_COOKIE, verifySession } from "./token";

export type AuthMode = "dev" | "clerk";

export function authMode(): AuthMode {
  if (process.env.AUTH_MODE === "clerk") return "clerk";
  // De dev-login (inloggen met alleen een e-mailadres) mag nooit in productie draaien: dan kan iedereen elk account openen
  if (process.env.APP_ENV === "production") throw new Error("APP_ENV=production vereist AUTH_MODE=clerk (de dev-login is uitgeschakeld)");
  return "dev";
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ontbreekt (zie .env.example)");
  return secret;
}

export interface Session {
  user: { id: string; email: string; name: string | null; isPlatformAdmin: boolean; onboarded: boolean };
  workspace: {
    id: string; name: string; slug: string; plan: PlanId; niches: string[]; countries: string[];
    billingStatus: string; trialEndsAt: Date | null;
  };
  role: Role;
}

interface Identity {
  providerId: string;
  email: string;
  name: string | null;
  org?: { providerId: string; name: string; role: Role };
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
}

/**
 * Platformbeheerders (toegang tot /admin): `users.is_platform_admin`, of een e-mailadres/domein in PLATFORM_ADMIN_EMAILS
 * (komma-gescheiden; "@domein.nl" voor een heel domein). Workspace-eigenaren zijn géén platformbeheerders.
 */
export function isConfiguredAdmin(email: string): boolean {
  const list = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const e = email.toLowerCase();
  return list.some((x) => (x.startsWith("@") ? e.endsWith(x) : e === x));
}

/** Zoekt of maakt gebruiker, workspace en lidmaatschap. Idempotent; draait bij elke eerste request per sessie. */
/** Cookie met de gekozen workspace als iemand lid is van meerdere (na een uitnodiging). Alleen een voorkeur: lidmaatschap wordt altijd gecontroleerd. */
export const WORKSPACE_COOKIE = "ts_ws";

export async function provision(identity: Identity, preferredWorkspaceId?: string): Promise<Session> {
  const db = getDb();
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto("users")
      .values({ auth_provider_id: identity.providerId, email: identity.email.toLowerCase(), name: identity.name })
      .onConflict((oc) => oc.column("email").doUpdateSet({ auth_provider_id: identity.providerId, updated_at: new Date() }))
      .returningAll()
      .executeTakeFirstOrThrow();

    let workspaceId: string;
    let role: Role;
    if (identity.org) {
      const ws = await trx
        .insertInto("workspaces")
        .values({ auth_provider_id: identity.org.providerId, name: identity.org.name, slug: `${slugify(identity.org.name)}-${identity.org.providerId.slice(-6).toLowerCase()}` })
        .onConflict((oc) => oc.column("auth_provider_id").doUpdateSet({ name: identity.org!.name }))
        .returning("id")
        .executeTakeFirstOrThrow();
      workspaceId = ws.id;
      role = identity.org.role;
      await trx
        .insertInto("memberships")
        .values({ workspace_id: workspaceId, user_id: user.id, role })
        .onConflict((oc) => oc.columns(["workspace_id", "user_id"]).doUpdateSet({ role }))
        .execute();
    } else {
      const existing = await trx
        .selectFrom("memberships")
        .select(["workspace_id", "role"])
        .where("user_id", "=", user.id)
        // Eerst de gekozen workspace (als je daar nog lid van bent), anders de oudste
        .orderBy(sql`workspace_id = ${preferredWorkspaceId && /^[0-9a-f-]{36}$/.test(preferredWorkspaceId) ? preferredWorkspaceId : null}::uuid`, sql`desc nulls last`)
        .orderBy("created_at")
        .executeTakeFirst();
      if (existing) {
        workspaceId = existing.workspace_id;
        role = existing.role;
      } else {
        const base = identity.name ?? identity.email.split("@")[0]!;
        // Nieuwe gebruikers starten met een Pro-trial van 7 dagen; wie al eerder een workspace had (en die verwijderde), niet opnieuw
        const hadWorkspace = await trx.selectFrom("audit_logs").select("id").where("actor_id", "=", user.id).where("action", "=", "workspace.delete").executeTakeFirst();
        const ws = await trx
          .insertInto("workspaces")
          .values({
            name: `${base}'s workspace`,
            slug: `${slugify(base)}-${user.id.slice(-6)}${hadWorkspace ? `-${Date.now().toString(36).slice(-4)}` : ""}`,
            ...(hadWorkspace
              ? { plan: "free" as const, billing_status: "none", trial_used: true }
              : { plan: "pro" as const, trial_ends_at: new Date(Date.now() + 7 * 86_400_000), billing_status: "trialing", trial_used: true }),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        workspaceId = ws.id;
        role = "owner";
        await trx.insertInto("memberships").values({ workspace_id: workspaceId, user_id: user.id, role }).execute();
      }
    }

    let workspace = await trx.selectFrom("workspaces").selectAll().where("id", "=", workspaceId).executeTakeFirstOrThrow();
    // Trial verlopen zonder betaald abonnement → terug naar Free (de data blijft, de limieten gaan omlaag)
    if (workspace.billing_status === "trialing" && workspace.trial_ends_at && new Date(workspace.trial_ends_at) < new Date()) {
      workspace = await trx
        .updateTable("workspaces")
        .set({ plan: "free", billing_status: "none", updated_at: new Date() })
        .where("id", "=", workspaceId)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return {
      user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.is_platform_admin || isConfiguredAdmin(user.email), onboarded: !!user.onboarded_at },
      workspace: {
        id: workspace.id, name: workspace.name, slug: workspace.slug, plan: workspace.plan, niches: workspace.niches, countries: workspace.countries,
        billingStatus: workspace.billing_status, trialEndsAt: workspace.trial_ends_at ? new Date(workspace.trial_ends_at) : null,
      },
      role,
    };
  });
}

async function clerkIdentity(): Promise<Identity | null> {
  const { auth, currentUser } = await import("@clerk/nextjs/server");
  const { userId, orgId, orgRole } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress;
  if (!user || !email) return null;
  let org: Identity["org"];
  if (orgId) {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const organization = await (await clerkClient()).organizations.getOrganization({ organizationId: orgId });
    org = { providerId: orgId, name: organization.name, role: orgRole === "org:admin" ? "admin" : "member" };
    if (organization.createdBy === userId) org.role = "owner";
  }
  return { providerId: userId, email, name: user.fullName, org };
}

export const getSession = cache(async (): Promise<Session | null> => {
  // Verkeerd geconfigureerde productie (geen Clerk): niemand is ingelogd; publieke pagina's blijven werken, de rest geeft 503
  if (process.env.AUTH_MODE !== "clerk" && process.env.APP_ENV === "production") return null;
  if (authMode() === "clerk") {
    const identity = await clerkIdentity();
    // Clerk-organisatie bepaalt de workspace; zonder organisatie geldt dezelfde voorkeurscookie als in dev
    return identity ? provision(identity, identity.org ? undefined : (await cookies()).get(WORKSPACE_COOKIE)?.value) : null;
  }
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, authSecret());
  if (!payload) return null;
  const jar = await cookies();
  return provision({ providerId: `dev:${payload.email}`, email: payload.email, name: null }, jar.get(WORKSPACE_COOKIE)?.value);
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(authMode() === "clerk" ? "/sign-in" : "/login");
  return session;
}
