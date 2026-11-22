import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { PLAN_IDS, PLANS, type Feature, type PlanId } from "@trendscope/core";
import type { Translator } from "@/lib/i18n/translate";
import { cn, formatNumber } from "@/lib/utils";
import { startCheckout } from "@/server/actions/billing";

const FEATURES: Feature[] = ["searches_per_day", "tracked_shops", "alerts", "exports_per_month", "ai_assistant", "seats", "api_access", "leads_export"];

/** Prijstabel; met sessie: knoppen starten Checkout, zonder sessie: naar inloggen. */
export function PricingTable({ t, interval, currentPlan, loggedIn, canBuy }: { t: Translator; interval: "month" | "year"; currentPlan?: PlanId; loggedIn: boolean; canBuy: boolean }) {
  const L = t.locale;
  return (
    <div className="space-y-6">
      <div className="mx-auto flex w-fit rounded-xl border border-border bg-surface p-1 text-sm" role="tablist">
        {(["month", "year"] as const).map((i) => (
          <Link key={i} href={`?interval=${i}`} role="tab" aria-selected={interval === i} className={cn("rounded-lg px-4 py-1.5 font-medium", interval === i ? "bg-fg text-bg" : "text-fg-muted hover:text-fg")}>
            {i === "month" ? t("billing.monthly") : t("billing.yearly")}{i === "year" && <span className="ml-1.5 text-xs text-accent-strong">{t("billing.yearlySave")}</span>}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="pricing-table">
        {PLAN_IDS.map((id) => {
          const p = PLANS[id];
          const price = interval === "year" ? p.priceYearlyEur : p.priceMonthlyEur;
          const featured = id === "pro";
          return (
            <div key={id} className={cn("flex flex-col rounded-3xl border bg-surface p-6 shadow-sm", featured ? "border-accent ring-2 ring-accent/30" : "border-border")}>
              <p className="text-sm font-semibold text-fg-muted">{t(`billing.plans.${id}`)}</p>
              <p className="mt-1 text-xs text-fg-subtle">{t(`billing.taglines.${id}`)}</p>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{price === 0 ? t("billing.free") : `€${formatNumber(price, L)}`}</span>
                {price > 0 && <span className="text-sm text-fg-muted">{interval === "year" ? t("billing.perYear") : t("billing.perMonth")}</span>}
              </p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                <li className="flex gap-2"><Check className="size-4 shrink-0 text-accent-strong" />{t("billing.features.dataWindowDays", { n: p.dataWindowDays })}</li>
                {FEATURES.map((f) => {
                  const n = p.limits[f];
                  return (
                    <li key={f} className={cn("flex gap-2", n === 0 && "text-fg-subtle")}>
                      {n === 0 ? <Minus className="size-4 shrink-0" /> : <Check className="size-4 shrink-0 text-accent-strong" />}
                      {n === 0 ? `${t(`billing.features.${f}`, { n: "" }).trim()} — ${t("billing.notIncluded").toLowerCase()}` : t(`billing.features.${f}`, { n: n === Infinity ? t("billing.unlimited") : formatNumber(n, L) })}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-6">
                {currentPlan === id ? (
                  <span className="block rounded-xl border border-border py-2.5 text-center text-sm font-medium text-fg-muted">{t("billing.current")}</span>
                ) : id === "free" ? null : !loggedIn ? (
                  <Link href="/login" className="block rounded-xl bg-accent py-2.5 text-center text-sm font-semibold text-accent-fg">{t("billing.startTrial")}</Link>
                ) : canBuy ? (
                  <form action={startCheckout}>
                    <input type="hidden" name="plan" value={id} />
                    <input type="hidden" name="interval" value={interval} />
                    <button type="submit" className={cn("w-full rounded-xl py-2.5 text-sm font-semibold", featured ? "bg-accent text-accent-fg" : "border border-border hover:bg-surface-hover")}>
                      {t("billing.choose", { plan: t(`billing.plans.${id}`) })}
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
