import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { getDb } from "@trendscope/db";

type ClerkEvent =
  | { type: "user.created" | "user.updated"; data: { id: string; email_addresses: { email_address: string; id: string }[]; primary_email_address_id: string; first_name: string | null; last_name: string | null } }
  | { type: "user.deleted"; data: { id: string } }
  | { type: "organization.created" | "organization.updated"; data: { id: string; name: string; slug: string } }
  | { type: "organizationMembership.deleted"; data: { organization: { id: string }; public_user_data: { user_id: string } } };

/** Synchroniseert Clerk-gebruikers en -organisaties naar Postgres (ondertekend via Svix). */
export async function POST(req: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 501 });
  const body = await req.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(body, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as unknown as ClerkEvent;
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  const db = getDb();
  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const email = event.data.email_addresses.find((e) => e.id === event.data.primary_email_address_id)?.email_address;
      if (!email) break;
      const name = [event.data.first_name, event.data.last_name].filter(Boolean).join(" ") || null;
      await db
        .insertInto("users")
        .values({ auth_provider_id: event.data.id, email: email.toLowerCase(), name })
        .onConflict((oc) => oc.column("auth_provider_id").doUpdateSet({ email: email.toLowerCase(), name, updated_at: new Date() }))
        .execute();
      break;
    }
    case "user.deleted":
      // AVG: verwijder het account; workspace-data blijft van de workspace
      await db.deleteFrom("users").where("auth_provider_id", "=", event.data.id).execute();
      break;
    case "organization.created":
    case "organization.updated":
      await db
        .insertInto("workspaces")
        .values({ auth_provider_id: event.data.id, name: event.data.name, slug: `${event.data.slug}-${event.data.id.slice(-6).toLowerCase()}` })
        .onConflict((oc) => oc.column("auth_provider_id").doUpdateSet({ name: event.data.name }))
        .execute();
      break;
    case "organizationMembership.deleted":
      await db
        .deleteFrom("memberships")
        .where("workspace_id", "in", db.selectFrom("workspaces").select("id").where("auth_provider_id", "=", event.data.organization.id))
        .where("user_id", "in", db.selectFrom("users").select("id").where("auth_provider_id", "=", event.data.public_user_data.user_id))
        .execute();
      break;
  }
  return NextResponse.json({ ok: true });
}
