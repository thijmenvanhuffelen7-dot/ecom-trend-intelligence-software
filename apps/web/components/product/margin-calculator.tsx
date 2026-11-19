"use client";

import { useState } from "react";
import { unitEconomics } from "@trendscope/core";
import { useT } from "@/lib/i18n/client";
import { cn, formatMoney } from "@/lib/utils";

function Field({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="relative mt-1">
        <input
          type="number"
          step="0.01"
          min={0}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="tabular h-10 w-full rounded-xl border border-border bg-surface pr-8 pl-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:outline-none"
        />
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-xs text-fg-subtle">{suffix}</span>
      </div>
    </label>
  );
}

export function MarginCalculator({ salePrice, productCost, shippingCost }: { salePrice: number; productCost: number; shippingCost: number }) {
  const t = useT();
  const [sale, setSale] = useState(salePrice);
  const [cost, setCost] = useState(productCost);
  const [ship, setShip] = useState(shippingCost);
  const [fee, setFee] = useState(3.5);
  const [cpa, setCpa] = useState(Math.round(salePrice * 0.3 * 100) / 100);
  const r = unitEconomics({ salePrice: sale, productCost: cost, shippingCost: ship, feePct: fee / 100, cpa });
  const good = r.netMargin >= 0.15;
  return (
    <div className="grid gap-5 md:grid-cols-[1fr_220px]">
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("products.salePrice")} value={sale} onChange={setSale} suffix="€" />
        <Field label={t("products.productCost")} value={cost} onChange={setCost} suffix="€" />
        <Field label={t("products.shipping")} value={ship} onChange={setShip} suffix="€" />
        <Field label={t("products.fees")} value={fee} onChange={setFee} suffix="%" />
        <Field label={t("products.cpa")} value={cpa} onChange={setCpa} suffix="€" />
      </div>
      <div className={cn("flex flex-col justify-between rounded-2xl p-4", good ? "bg-accent-soft" : "bg-danger-soft")}>
        <div>
          <p className="text-xs font-medium text-fg-muted">{t("products.netProfit")}</p>
          <p className={cn("tabular mt-1 text-3xl font-semibold tracking-tight", good ? "text-accent-strong" : "text-danger")}>{formatMoney(r.netProfit, "EUR", t.locale)}</p>
        </div>
        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-fg-muted">{t("products.netMargin")}</dt>
            <dd className="tabular font-semibold">{(r.netMargin * 100).toFixed(1)}%</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-fg-muted">{t("products.breakEvenRoas")}</dt>
            <dd className="tabular font-semibold">{Number.isFinite(r.breakEvenRoas) ? r.breakEvenRoas.toFixed(2) : "∞"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
