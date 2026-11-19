import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@trendscope/db";
import type { PlanId, Role } from "@trendscope/core";
import { SESSION_COOKIE, verifySession } from "./token";

export type AuthMode = "dev" | "clerk";

export function authMode(): AuthMode {
  return process.env.AUTH_MODE === "clerk" ? "clerk" : "dev";
}

export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET ontbreekt (zie .env.example)");
  return secret;
}

export interface Session {
  user: { id: string; email: string; name: string | null; isPlatformAdmin: boolean; onboarded: boolean };
  workspace: { id: string; name: string; slug: string; plan: PlanId; niches: string[]; countries: string[] };
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

/** Zoekt of maakt gebruiker, workspace en lidmaatschap. Idempotent; draait bij elke eerste request per sessie. */
export async function provision(identity: Identity): Promise<Session> {
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
        .orderBy("created_at")
        .executeTakeFirst();
      if (existing) {
        workspaceId = existing.workspace_id;
        role = existing.role;
      } else {
        const base = identity.name ?? identity.email.split("@")[0]!;
        const ws = await trx
          .insertInto("workspaces")
          .values({
            name: `${base}'s workspace`,
            slug: `${slugify(base)}-${user.id.slice(-6)}`,
            // Nieuwe workspaces starten met een Pro-trial van 7 dagen
            plan: "pro",
            trial_ends_at: new Date(Date.now() + 7 * 86_400_000),
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        workspaceId = ws.id;
        role = "owner";
        await trx.insertInto("memberships").values({ workspace_id: workspaceId, user_id: user.id, role }).execute();
      }
    }

    const workspace = await trx.selectFrom("workspaces").selectAll().where("id", "=", workspaceId).executeTakeFirstOrThrow();
    return {
      user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.is_platform_admin, onboarded: !!user.onboarded_at },
      workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, plan: workspace.plan, niches: workspace.niches, countries: workspace.countries },
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
  if (authMode() === "clerk") {
    const identity = await clerkIdentity();
    return identity ? provision(identity) : null;
  }
  const payload = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, authSecret());
  if (!payload) return null;
  return provision({ providerId: `dev:${payload.email}`, email: payload.email, name: null });
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect(authMode() === "clerk" ? "/sign-in" : "/login");
  return session;
}
