import Link from "next/link";
import { AlertTriangle, CreditCard, FileText, Gauge, Info } from "lucide-react";
import { getDb } from "@trendscope/db";
import { PLANS } from "@trendscope/core";
import { PricingTable } from "@/components/billing/pricing-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Meter } from "@/components/ui/score";
import { requireSession } from "@/lib/auth/server";
import { getT } from "@/lib/i18n/server";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/utils";
import { cancelDemo, openPortal } from "@/server/actions/billing";
import { stripe } from "@/server/billing/stripe";
import { usageOverview } from "@/server/billing/usage";

export const metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ interval?: string; success?: string; demo?: string }> }) {
  const session = await requireSession();
  const t = await getT();
  const sp = await searchParams;
  const L = t.locale;
  const db = getDb();
  const ws = session.workspace;
  const [usage, invoices, sub] = await Promise.all([
    usageOverview(ws.id, ws.plan),
    db.selectFrom("invoices").selectAll().where("workspace_id", "=", ws.id).orderBy("created_at", "desc").limit(24).execute(),
    db.selectFrom("subscriptions").selectAll().where("workspace_id", "=", ws.id).orderBy("updated_at", "desc").executeTakeFirst(),
  ]);
  const live = !!stripe();
  const trialDays = ws.trialEndsAt ? Math.max(0, Math.ceil((ws.trialEndsAt.getTime() - Date.now()) / 86_400_000)) : null;
  const isOwner = session.role === "owner";

  return (
    <div className="animate-rise">
      <header className="border-b border-border bg-bg px-8 pt-9 pb-7">
        <Link href="/settings" className="text-sm text-fg-muted hover:text-fg">← {t("settings.title")}</Link>
        <h1 className="mt-2 flex items-center gap-3 text-[28px] font-semibold tracking-tight">
          <span className="grid size-10 place-items-center rounded-xl bg-bg-subtle"><CreditCard className="size-5" /></span>
          {t("billing.title")}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3" data-testid="billing-status">
          <Badge tone="accent" className="text-sm">{t(`billing.plans.${ws.plan}`)}</Badge>
          <Badge tone={ws.billingStatus === "past_due" ? "danger" : "outline"}>{t(`billing.status.${ws.billingStatus as "active"}`)}</Badge>
          {ws.billingStatus === "trialing" && trialDays !== null && <span className="text-sm text-fg-muted">{t("billing.trialLeft", { days: trialDays })}</span>}
          {sub?.current_period_end && ws.billingStatus !== "trialing" && <span className="text-sm text-fg-muted">{t("billing.renews", { date: formatDateTime(sub.current_period_end, L) })}</span>}
          {isOwner && live && ws.billingStatus !== "none" && ws.billingStatus !== "demo" && (
            <form action={openPortal}><button className="rounded-xl border border-border px-3.5 py-1.5 text-sm font-medium hover:bg-surface-hover">{t("billing.manage")}</button></form>
          )}
          {isOwner && ws.billingStatus === "demo" && (
            <form action={cancelDemo}><button className="rounded-xl border border-border px-3.5 py-1.5 text-sm font-medium hover:bg-surface-hover">{t("billing.cancelDemo")}</button></form>
          )}
        </div>
        {ws.billingStatus === "past_due" && <p className="mt-3 flex items-center gap-2 text-sm text-danger"><AlertTriangle className="size-4" /> {t("billing.pastDueNote")}</p>}
        {sp.success && <p className="mt-3 text-sm text-accent-strong">{t("billing.successNote")}</p>}
        {!live && <p className="mt-3 flex items-center gap-2 text-xs text-fg-subtle"><Info className="size-3.5" /> {t("billing.demoNote")}</p>}
      </header>
      <div className="space-y-5 bg-bg-subtle/60 p-6">
        <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
          <Card data-testid="usage">
            <CardHeader icon={<Gauge />} title={t("billing.usage")} hint={t("billing.windowNote", { days: PLANS[ws.plan].dataWindowDays })} />
            <CardBody className="space-y-3">
              {usage.map((u) => (
                <div key={u.feature} className="grid grid-cols-[1fr_120px] items-center gap-4 text-sm">
                  <div>
                    <p className="mb-1">{t(`billing.features.${u.feature}`, { n: "" }).replace(/^\s+/, "")}</p>
                    {u.limit > 0 && u.limit !== Infinity ? <Meter value={Math.min(100, (u.used / u.limit) * 100)} invert /> : null}
                  </div>
                  <p className="tabular text-right">
                    {u.limit === 0 ? <span className="text-fg-subtle">{t("billing.notIncluded")}</span> : `${formatNumber(u.used, L)} / ${u.limit === Infinity ? "∞" : formatNumber(u.limit, L)}`}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon={<FileText />} title={t("billing.invoices")} />
            {invoices.length === 0 ? (
              <CardBody><p className="text-sm text-fg-muted">{t("billing.noInvoices")}</p></CardBody>
            ) : (
              <ul className="divide-y divide-border border-t border-border text-sm" data-testid="invoices">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1 truncate font-medium">{inv.number ?? inv.id}</span>
                    <span className="text-xs text-fg-muted">{formatDateTime(inv.created_at, L)}</span>
                    <Badge tone={inv.status === "paid" ? "accent" : "warning"}>{inv.status}</Badge>
                    <span className="tabular w-28 text-right">
                      {formatMoney(inv.amount_due / 100, inv.currency.toUpperCase(), L)}
                      {inv.tax != null && <span className="block text-xs text-fg-subtle">{t("billing.vat")} {formatMoney(inv.tax / 100, inv.currency.toUpperCase(), L)}</span>}
                    </span>
                    {inv.hosted_invoice_url && <a href={inv.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-accent-strong hover:underline">PDF</a>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <PricingTable t={t} interval={sp.interval === "year" ? "year" : "month"} currentPlan={ws.billingStatus === "trialing" ? undefined : ws.plan} loggedIn canBuy={isOwner} />
      </div>
    </div>
  );
}
