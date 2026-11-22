/**
 * Integratie: Stripe-webhook met echt ondertekende events tegen de echte database (RUN_INTEGRATION=1).
 * Alleen `subscriptions.retrieve` (een netwerkcall naar Stripe) wordt gestubd.
 */
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SECRET = "whsec_test_trendscope";
const subs = new Map<string, unknown>();

vi.mock("@/server/billing/stripe", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/billing/stripe")>();
  const client = new Stripe("sk_test_dummy");
  client.subscriptions.retrieve = (async (id: string) => subs.get(id)) as never;
  return { ...mod, stripe: () => client };
});

const run = !!process.env.RUN_INTEGRATION && !!process.env.DATABASE_URL;

describe.skipIf(!run)("stripe webhook", async () => {
  const { getDb } = await import("@trendscope/db");
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const signer = new Stripe("sk_test_dummy");
  const customer = `cus_test_${randomUUID().slice(0, 8)}`;
  let workspaceId = "";

  const send = (event: object, sig?: string) => {
    const payload = JSON.stringify(event);
    return POST(new Request("http://localhost/api/webhooks/stripe", {
      method: "POST",
      body: payload,
      headers: { "stripe-signature": sig ?? signer.webhooks.generateTestHeaderString({ payload, secret: SECRET }) },
    }));
  };
  const evt = (type: string, object: object) => ({ id: `evt_${randomUUID().replace(/-/g, "")}`, object: "event", type, data: { object } });

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.STRIPE_PRICE_PRO_MONTH = "price_pro_month_test";
    const ws = await getDb()
      .insertInto("workspaces")
      .values({ name: "Webhook test", slug: `wh-${randomUUID().slice(0, 8)}`, stripe_customer_id: customer, plan: "free" })
      .returning("id")
      .executeTakeFirstOrThrow();
    workspaceId = ws.id;
  });
  afterAll(async () => {
    await getDb().deleteFrom("workspaces").where("id", "=", workspaceId).execute();
    await getDb().destroy();
  });

  it("rejects a bad signature", async () => {
    const res = await send(evt("invoice.paid", {}), "t=1,v1=deadbeef");
    expect(res.status).toBe(400);
  });

  it("applies a subscription and downgrades when it is canceled", async () => {
    const sub = (status: string) => ({
      id: "sub_test_1", object: "subscription", customer, status, metadata: {}, cancel_at_period_end: false, trial_end: null,
      items: { data: [{ price: { id: "price_pro_month_test" }, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
    });
    subs.set("sub_test_1", sub("active"));
    expect((await send(evt("customer.subscription.created", { id: "sub_test_1" }))).status).toBe(200);
    let ws = await getDb().selectFrom("workspaces").select(["plan", "billing_status"]).where("id", "=", workspaceId).executeTakeFirstOrThrow();
    expect(ws).toEqual({ plan: "pro", billing_status: "active" });

    subs.set("sub_test_1", sub("canceled"));
    await send(evt("customer.subscription.deleted", { id: "sub_test_1" }));
    ws = await getDb().selectFrom("workspaces").select(["plan", "billing_status"]).where("id", "=", workspaceId).executeTakeFirstOrThrow();
    expect(ws).toEqual({ plan: "free", billing_status: "canceled" });
  });

  it("records an invoice exactly once, even when Stripe sends the event twice", async () => {
    const event = evt("invoice.paid", {
      id: `in_test_${randomUUID().slice(0, 8)}`, object: "invoice", customer, number: "TS-0001", status: "paid", currency: "eur",
      amount_due: 5929, amount_paid: 5929, total_taxes: [{ amount: 1029 }], period_start: 1_790_000_000, period_end: 1_792_600_000,
    });
    expect(await (await send(event)).json()).toEqual({ received: true });
    expect(await (await send(event)).json()).toEqual({ received: true, duplicate: true });
    const rows = await getDb().selectFrom("invoices").select(["amount_paid", "tax"]).where("workspace_id", "=", workspaceId).execute();
    expect(rows).toEqual([{ amount_paid: 5929, tax: 1029 }]);
  });
});
