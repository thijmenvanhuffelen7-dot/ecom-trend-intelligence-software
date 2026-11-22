import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@trendscope/db";
import { applySubscription, recordInvoice, stripe } from "@/server/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe-webhook. De handtekening wordt gecontroleerd op de ruwe body; elk event wordt precies één keer verwerkt
 * (stripe_events). Abonnementen halen we altijd opnieuw op bij Stripe, zodat de volgorde van events niet uitmaakt.
 */
export async function POST(req: Request) {
  const client = stripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!client || !secret) return new NextResponse("Billing not configured", { status: 503 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = client.webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }
  const db = getDb();
  const fresh = await db.insertInto("stripe_events").values({ id: event.id, type: event.type }).onConflict((oc) => oc.column("id").doNothing()).returning("id").executeTakeFirst();
  if (!fresh) {
    const prev = await db.selectFrom("stripe_events").select("processed_at").where("id", "=", event.id).executeTakeFirst();
    if (prev?.processed_at) return NextResponse.json({ received: true, duplicate: true });
  }
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        if (s.client_reference_id && s.customer) {
          const customer = typeof s.customer === "string" ? s.customer : s.customer.id;
          await db.updateTable("workspaces").set({ stripe_customer_id: customer }).where("id", "=", s.client_reference_id).execute();
        }
        if (s.subscription) await applySubscription(await client.subscriptions.retrieve(typeof s.subscription === "string" ? s.subscription : s.subscription.id));
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.trial_will_end":
        await applySubscription(await client.subscriptions.retrieve(event.data.object.id));
        break;
      case "invoice.paid":
      case "invoice.payment_failed":
      case "invoice.finalized":
        await recordInvoice(event.data.object);
        break;
    }
    await db.updateTable("stripe_events").set({ processed_at: new Date(), error: null }).where("id", "=", event.id).execute();
    return NextResponse.json({ received: true });
  } catch (e) {
    await db.updateTable("stripe_events").set({ error: String((e as Error).message).slice(0, 500) }).where("id", "=", event.id).execute();
    // 500 → Stripe probeert het later opnieuw
    return new NextResponse("Processing failed", { status: 500 });
  }
}
