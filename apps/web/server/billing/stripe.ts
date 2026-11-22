import "server-only";
import Stripe from "stripe";
import { getDb } from "@trendscope/db";
import type { PlanId } from "@trendscope/core";

export type Interval = "month" | "year";
export type PaidPlan = Exclude<PlanId, "free">;
export const PAID_PLANS: PaidPlan[] = ["starter", "pro", "business"];
export const TRIAL_DAYS = 7;

/** Live alleen met een geheime sleutel; anders de demo-checkout (duidelijk gelabeld, geen echte betaling). */
export function stripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

/** Prijs-ID's per plan en interval uit de omgeving, bv. STRIPE_PRICE_PRO_YEAR=price_… */
export function priceId(plan: PaidPlan, interval: Interval): string | undefined {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`];
}

export function planForPrice(id: string | null | undefined): { plan: PaidPlan; interval: Interval } | null {
  if (!id) return null;
  for (const plan of PAID_PLANS) for (const interval of ["month", "year"] as const) if (priceId(plan, interval) === id) return { plan, interval };
  return null;
}

/** Stripe-status → onze plan/status. Alleen actief of trialing geeft toegang tot het betaalde plan. */
export function accessFor(status: Stripe.Subscription.Status): { granted: boolean; billingStatus: "trialing" | "active" | "past_due" | "canceled" } {
  switch (status) {
    case "trialing":
      return { granted: true, billingStatus: "trialing" };
    case "active":
      return { granted: true, billingStatus: "active" };
    case "past_due":
      // Betaling mislukt: Stripe probeert opnieuw (smart retries); toegang blijft tot de status canceled/unpaid wordt
      return { granted: true, billingStatus: "past_due" };
    default:
      return { granted: false, billingStatus: "canceled" };
  }
}

/** Verwerkt een (nieuw of gewijzigd) abonnement: subscriptions-rij + plan en status van de workspace. */
export async function applySubscription(sub: Stripe.Subscription): Promise<void> {
  const db = getDb();
  const item = sub.items.data[0];
  const mapped = planForPrice(item?.price.id);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const ws = await db.selectFrom("workspaces").select("id").where("stripe_customer_id", "=", customer).executeTakeFirst();
  const workspaceId = ws?.id ?? sub.metadata.workspace_id;
  if (!workspaceId || !mapped) throw new Error(`Onbekende workspace of prijs voor ${sub.id}`);
  const { granted, billingStatus } = accessFor(sub.status);
  const periodEnd = item?.current_period_end ? new Date(item.current_period_end * 1000) : null;
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("subscriptions")
      .values({
        workspace_id: workspaceId, stripe_customer_id: customer, stripe_subscription_id: sub.id, plan: mapped.plan, interval: mapped.interval,
        status: sub.status, current_period_end: periodEnd, cancel_at_period_end: sub.cancel_at_period_end,
        trial_end: sub.trial_end ? new Date(sub.trial_end * 1000) : null, price_id: item?.price.id ?? null,
      })
      .onConflict((oc) => oc.column("stripe_subscription_id").doUpdateSet({
        plan: mapped.plan, interval: mapped.interval, status: sub.status, current_period_end: periodEnd,
        cancel_at_period_end: sub.cancel_at_period_end, trial_end: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        price_id: item?.price.id ?? null, updated_at: new Date(),
      }))
      .execute();
    await trx
      .updateTable("workspaces")
      .set({
        plan: granted ? mapped.plan : "free",
        billing_status: billingStatus,
        stripe_customer_id: customer,
        trial_used: true,
        trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
        updated_at: new Date(),
      })
      .where("id", "=", workspaceId)
      .execute();
  });
}

export async function recordInvoice(inv: Stripe.Invoice): Promise<void> {
  const customer = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
  if (!inv.id || !customer) return;
  const ws = await getDb().selectFrom("workspaces").select("id").where("stripe_customer_id", "=", customer).executeTakeFirst();
  if (!ws) return;
  const tax = inv.total_taxes?.reduce((a, t) => a + t.amount, 0) ?? null;
  await getDb()
    .insertInto("invoices")
    .values({
      id: inv.id, workspace_id: ws.id, number: inv.number, status: inv.status ?? "open", currency: inv.currency, amount_due: inv.amount_due,
      amount_paid: inv.amount_paid, tax, hosted_invoice_url: inv.hosted_invoice_url ?? null, invoice_pdf: inv.invoice_pdf ?? null,
      period_start: new Date(inv.period_start * 1000), period_end: new Date(inv.period_end * 1000),
    })
    .onConflict((oc) => oc.column("id").doUpdateSet({ status: inv.status ?? "open", amount_paid: inv.amount_paid, tax, hosted_invoice_url: inv.hosted_invoice_url ?? null, invoice_pdf: inv.invoice_pdf ?? null }))
    .execute();
}
