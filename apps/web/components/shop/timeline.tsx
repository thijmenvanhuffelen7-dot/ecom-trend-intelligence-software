"use client";

import { ArrowRightLeft, Ban, Code2, Layers, Minus, PackageCheck, Plus, Tag, Type } from "lucide-react";
import { useMemo, useState } from "react";
import { DeltaBadge } from "@/components/ui/badge";
import { useT } from "@/lib/i18n/client";
import { cn, formatMoney } from "@/lib/utils";
import type { TimelineEvent } from "@/server/queries/shop-detail";

const FILTERS = {
  all: null,
  added: ["product_added"],
  removed: ["product_removed"],
  price: ["price_changed", "compare_at_changed"],
  stock: ["out_of_stock", "back_in_stock", "variants_added", "variants_removed"],
  tech: ["tech_added", "tech_removed"],
} as const;

const ICON: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  product_added: { icon: Plus, cls: "bg-accent-soft text-accent-strong" },
  product_removed: { icon: Minus, cls: "bg-danger-soft text-danger" },
  price_changed: { icon: Tag, cls: "bg-info-soft text-info" },
  compare_at_changed: { icon: ArrowRightLeft, cls: "bg-info-soft text-info" },
  out_of_stock: { icon: Ban, cls: "bg-warning-soft text-[#b45309] dark:text-warning" },
  back_in_stock: { icon: PackageCheck, cls: "bg-accent-soft text-accent-strong" },
  variants_added: { icon: Layers, cls: "bg-bg-subtle text-fg-muted" },
  variants_removed: { icon: Layers, cls: "bg-bg-subtle text-fg-muted" },
  title_changed: { icon: Type, cls: "bg-bg-subtle text-fg-muted" },
  tech_added: { icon: Code2, cls: "bg-[#f5effc] text-[#7b3fb3] dark:bg-[#251b31] dark:text-[#c79cf0]" },
  tech_removed: { icon: Code2, cls: "bg-bg-subtle text-fg-muted" },
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function Timeline({ events, currency }: { events: TimelineEvent[]; currency: string }) {
  const t = useT();
  const [filter, setFilter] = useState<keyof typeof FILTERS>("all");
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const [k, types] of Object.entries(FILTERS)) c[k] = types ? events.filter((e) => (types as readonly string[]).includes(e.type)).length : events.length;
    return c;
  }, [events]);
  const shown = events.filter((e) => !FILTERS[filter] || (FILTERS[filter] as readonly string[]).includes(e.type));
  const groups = shown.reduce<Record<string, TimelineEvent[]>>((acc, e) => {
    (acc[dayKey(e.at)] ??= []).push(e);
    return acc;
  }, {});
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const label = (d: string) =>
    d === today ? t("timeline.today") : d === yesterday ? t("timeline.yesterday") : new Intl.DateTimeFormat(t.locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(d));
  const money = (v: unknown) => (typeof v === "number" ? formatMoney(v, currency, t.locale) : "—");

  if (!events.length) return <p className="py-10 text-center text-sm text-fg-muted">{t("timeline.empty")}</p>;

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(FILTERS) as (keyof typeof FILTERS)[]).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            disabled={!counts[k]}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] font-medium transition disabled:opacity-40",
              filter === k ? "border-fg bg-fg text-bg" : "border-border bg-surface hover:bg-surface-hover",
            )}
          >
            {t(`timeline.filters.${k}`)} <span className="tabular ml-1 opacity-60">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="scroll-area max-h-[560px] space-y-5 overflow-y-auto pr-1">
        {Object.entries(groups).map(([day, list]) => (
          <section key={day}>
            <h4 className="sticky top-0 z-10 mb-2 bg-surface/95 py-1 text-xs font-semibold tracking-wide text-fg-muted uppercase backdrop-blur">{label(day)}</h4>
            <ol className="relative ml-3 space-y-1 border-l border-border pl-5">
              {list.map((e, i) => {
                const meta = ICON[e.type] ?? ICON.title_changed!;
                const p = e.payload;
                return (
                  <li key={`${e.at}-${i}`} className="relative flex items-center gap-3 rounded-xl py-1.5 pr-2">
                    <span className={cn("absolute -left-[31px] grid size-5 place-items-center rounded-full ring-4 ring-surface", meta.cls)}>
                      <meta.icon className="size-3" />
                    </span>
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="size-9 shrink-0 rounded-lg border border-border object-cover" loading="lazy" />
                    ) : (
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", meta.cls)}>
                        <meta.icon className="size-4" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.title ?? p.name}</p>
                      <p className="text-xs text-fg-muted">
                        {t(`timeline.events.${e.type as "product_added"}`)}
                        {e.type === "product_added" && p.price != null && <> · {money(p.price)}</>}
                        {(e.type === "variants_added" || e.type === "variants_removed") && p.variants && <> · {p.variants.join(", ")}</>}
                        {e.type === "title_changed" && <> · „{String(p.old)}”</>}
                      </p>
                    </div>
                    {(e.type === "price_changed" || e.type === "compare_at_changed") && (
                      <div className="flex shrink-0 items-center gap-2 text-sm">
                        <span className="tabular text-fg-subtle line-through">{money(p.old)}</span>
                        <span className="tabular font-semibold">{money(p.new)}</span>
                        {e.type === "price_changed" && <DeltaBadge value={p.pct} />}
                      </div>
                    )}
                    <time className="tabular shrink-0 text-xs text-fg-subtle">{new Date(e.at).toLocaleTimeString(t.locale, { hour: "2-digit", minute: "2-digit" })}</time>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
