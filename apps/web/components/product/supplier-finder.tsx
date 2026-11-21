"use client";

import { useState } from "react";
import { Check, ExternalLink, Star, Truck, Zap } from "lucide-react";
import { MarginCalculator } from "@/components/product/margin-calculator";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n/client";
import { cn, formatMoney } from "@/lib/utils";

export type SupplierOffer = {
  id: string;
  name: string;
  source: string;
  price: number;
  shipping_cost: number;
  currency: string;
  orders: number | null;
  rating: number | null;
  positive_rate: number | null;
  country: string | null;
  url: string | null;
  shipping_days: string | null;
  product_title: string | null;
};

const SOURCE_LABEL: Record<string, string> = { aliexpress: "AliExpress", cj: "CJ", alibaba: "Alibaba", "1688": "1688" };

/** "[7,16)" → [7, 15] */
function days(range: string | null): [number, number] | null {
  if (!range) return null;
  const m = /^[[(](\d+),(\d+)[)\]]$/.exec(range);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]) - (range.endsWith(")") ? 1 : 0)];
}

/** Leveranciers naast elkaar (totaal geleverd = inkoop + verzending), en de gekozen leverancier rekent mee in de marge. */
export function SupplierFinder({ offers, salePrice }: { offers: SupplierOffer[]; salePrice: number }) {
  const t = useT();
  const L = t.locale;
  const landed = (o: SupplierOffer) => o.price + o.shipping_cost;
  const cheapestId = offers.reduce<SupplierOffer | null>((a, o) => (!a || landed(o) < landed(a) ? o : a), null)?.id;
  const fastestId = offers.reduce<SupplierOffer | null>((a, o) => {
    const d = days(o.shipping_days);
    const ad = a ? days(a.shipping_days) : null;
    return d && (!ad || d[1] < ad[1]) ? o : a;
  }, null)?.id;
  const [selected, setSelected] = useState(cheapestId);
  const chosen = offers.find((o) => o.id === selected) ?? offers[0];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
      {offers.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-fg-muted">{t("products.noSuppliers")}</p>
      ) : (
        <ul className="max-h-[420px] divide-y divide-border overflow-y-auto rounded-2xl border border-border" data-testid="supplier-list">
          {offers.map((o) => {
            const d = days(o.shipping_days);
            const active = o.id === chosen?.id;
            return (
              <li key={o.id} className={cn("flex items-center transition hover:bg-surface-hover", active && "bg-accent-soft/60")}>
                <button
                  type="button"
                  onClick={() => setSelected(o.id)}
                  aria-pressed={active}
                  title={t("products.useSupplier")}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left"
                >
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl text-[10px] font-bold uppercase", active ? "bg-accent text-accent-fg" : "bg-bg-subtle")}>
                    {active ? <Check className="size-4" strokeWidth={3} /> : (SOURCE_LABEL[o.source] ?? o.source).slice(0, 3)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      <span className="truncate">{o.name}</span>
                      {o.id === cheapestId && <Badge tone="accent">{t("products.cheapest")}</Badge>}
                      {o.id === fastestId && o.id !== cheapestId && (
                        <Badge tone="outline">
                          <Zap /> {t("products.fastest")}
                        </Badge>
                      )}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
                      <span>{SOURCE_LABEL[o.source] ?? o.source}</span>
                      {o.rating !== null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Star className="size-3 fill-warning text-warning" /> {o.rating.toFixed(1)}
                        </span>
                      )}
                      {d && (
                        <span className="inline-flex items-center gap-0.5">
                          <Truck className="size-3" /> {t("products.deliveryDays", { min: d[0], max: d[1] })}
                        </span>
                      )}
                      {o.orders ? <span>{t("products.orders", { count: o.orders })}</span> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular text-sm font-semibold">{formatMoney(landed(o), o.currency, L)}</p>
                    <p className="tabular text-xs text-fg-subtle">
                      {o.shipping_cost > 0 ? `${formatMoney(o.price, o.currency, L)} + ${formatMoney(o.shipping_cost, o.currency, L)}` : t("products.freeShipping")}
                    </p>
                  </div>
                </button>
                {o.url ? (
                  <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="px-3 py-3 text-fg-subtle hover:text-fg" aria-label={o.name}>
                    <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <span className="w-4" />
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <p className="mb-3 text-sm font-semibold">
          {t("products.calculator")}
          {chosen && <span className="ml-2 font-normal text-fg-muted">· {chosen.name}</span>}
        </p>
        <MarginCalculator
          key={chosen?.id ?? "none"}
          salePrice={Number(salePrice.toFixed(2))}
          productCost={chosen ? Number(chosen.price.toFixed(2)) : 5}
          shippingCost={chosen ? Number(chosen.shipping_cost.toFixed(2)) : 3}
        />
      </div>
    </div>
  );
}
