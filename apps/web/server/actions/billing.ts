"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@trendscope/db";
import { assertCan, PLANS } from "@trendscope/core";
import { requireSession } from "@/lib/auth/server";
import { PAID_PLANS, priceId, stripe, TRIAL_DAYS } from "@/server/billing/stripe";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const Input = z.object({ plan: z.enum(PAID_PLANS as [string, ...string[]]), interval: z.enum(["month", "year"]) });

/** Start een Stripe Checkout (abonnement, trial, btw via Stripe Tax, btw-nummer) — of de demo-checkout zonder sleutel. */
export async function startCheckout(formData: FormData): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, "billing.manage");
  const { plan, interval } = Input.parse({ plan: formData.get("plan"), interval: formData.get("interval") });
  const client = stripe();
  const db = getDb();
  if (!client) {
    // Demo: geen betaling, wel dezelfde gevolgen in de app (plan, status, factuurregel). Duidelijk gelabeld in de UI.
    const amount = (interval === "year" ? PLANS[plan as "pro"].priceYearlyEur : PLANS[plan as "pro"].priceMonthlyEur) * 100;
    const now = new Date();
    const end = new Date(now.getTime() + (interval === "year" ? 365 : 30) * 86_400_000);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("workspaces").set({ plan: plan as "pro", billing_status: "demo", trial_used: true, trial_ends_at: null, updated_at: now }).where("id", "=", session.workspace.id).execute();
      await trx.insertInto("subscriptions").values({
        workspace_id: session.workspace.id, stripe_subscription_id: `demo_${session.workspace.id}_${now.getTime()}`, plan: plan as "pro",
        interval, status: "active", current_period_end: end,
      }).execute();
      await trx.insertInto("invoices").values({
        id: `demo_${now.getTime()}`, workspace_id: session.workspace.id, number: `DEMO-${now.getTime().toString().slice(-6)}`, status: "paid",
        amount_due: Math.round(amount * 1.21), amount_paid: Math.round(amount * 1.21), tax: Math.round(amount * 0.21), period_start: now, period_end: end,
      }).execute();
    });
    revalidatePath("/settings/billing");
    redirect("/settings/billing?demo=1");
  }
  const price = priceId(plan as "pro", interval);
  if (!price) throw new Error(`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()} ontbreekt`);
  const ws = await db.selectFrom("workspaces").select(["stripe_customer_id", "trial_used"]).where("id", "=", session.workspace.id).executeTakeFirstOrThrow();
  const checkout = await client.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: session.workspace.id,
    ...(ws.stripe_customer_id ? { customer: ws.stripe_customer_id, customer_update: { address: "auto", name: "auto" } } : { customer_email: session.user.email }),
    line_items: [{ price, quantity: 1 }],
    subscription_data: { metadata: { workspace_id: session.workspace.id }, ...(ws.trial_used ? {} : { trial_period_days: TRIAL_DAYS }) },
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    allow_promotion_codes: true,
    success_url: `${appUrl()}/settings/billing?success=1`,
    cancel_url: `${appUrl()}/pricing`,
  });
  redirect(checkout.url!);
}

/** Klantportaal van Stripe: betaalmethode, facturen, opzeggen, plan wisselen. */
export async function openPortal(): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, "billing.manage");
  const client = stripe();
  const ws = await getDb().selectFrom("workspaces").select("stripe_customer_id").where("id", "=", session.workspace.id).executeTakeFirstOrThrow();
  if (!client || !ws.stripe_customer_id) redirect("/settings/billing");
  const portal = await client.billingPortal.sessions.create({ customer: ws.stripe_customer_id, return_url: `${appUrl()}/settings/billing` });
  redirect(portal.url);
}

/** Demo-abonnement opzeggen (zonder Stripe). */
export async function cancelDemo(): Promise<void> {
  const session = await requireSession();
  assertCan(session.role, "billing.manage");
  await getDb().updateTable("workspaces").set({ plan: "free", billing_status: "canceled" }).where("id", "=", session.workspace.id).where("billing_status", "=", "demo").execute();
  revalidatePath("/settings/billing");
  redirect("/settings/billing");
}
