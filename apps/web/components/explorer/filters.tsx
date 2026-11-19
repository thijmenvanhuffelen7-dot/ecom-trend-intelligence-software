"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import { useUpdateParams } from "./use-params";

export interface Option {
  value: string;
  label: string;
  count?: number;
  prefix?: React.ReactNode;
}

function Chip({ label, icon, active, summary }: { label: string; icon: React.ReactNode; active: boolean; summary?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition [&>svg:first-child]:size-4",
        active
          ? "border-accent/40 bg-accent-soft text-accent-strong shadow-[0_0_0_3px_rgb(31_185_90/0.08)]"
          : "border-border bg-surface text-fg hover:border-border-strong hover:bg-surface-hover",
      )}
    >
      {icon}
      {label}
      {summary && <span className="max-w-28 truncate rounded-full bg-accent px-1.5 text-[11px] leading-[18px] font-semibold text-accent-fg">{summary}</span>}
      <ChevronDown className="size-3.5 opacity-60" />
    </span>
  );
}

/** Meervoudige selectie, bv. landen, niches, pixels, apps. */
export function MultiFilter({ param, label, icon, options, searchable = options.length > 8 }: { param: string; label: string; icon: React.ReactNode; options: Option[]; searchable?: boolean }) {
  const t = useT();
  const { update, searchParams } = useUpdateParams();
  const selected = useMemo(() => new Set((searchParams.get(param) ?? "").split(",").filter(Boolean)), [searchParams, param]);
  const [draft, setDraft] = useState<Set<string>>(selected);
  const [query, setQuery] = useState("");
  const shown = options.filter((o) => !query || o.label.toLowerCase().includes(query.toLowerCase()));

  const toggle = (v: string) => {
    const next = new Set(draft);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setDraft(next);
  };

  return (
    <Popover onOpenChange={(open) => open && (setDraft(new Set(selected)), setQuery(""))}>
      <PopoverTrigger className="rounded-full focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
        <Chip label={label} icon={icon} active={selected.size > 0} summary={selected.size ? String(selected.size) : undefined} />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        {searchable && (
          <div className="relative border-b border-border p-2">
            <Search className="absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={label}
              className="h-9 w-full rounded-lg bg-bg-subtle pr-3 pl-8 text-sm focus:outline-none"
            />
          </div>
        )}
        <div className="scroll-area max-h-72 overflow-y-auto p-1.5">
          {shown.map((o) => {
            const on = draft.has(o.value);
            return (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-hover"
              >
                <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition", on ? "border-accent bg-accent text-accent-fg" : "border-border-strong")}>
                  {on && <Check className="size-3" strokeWidth={3} />}
                </span>
                {o.prefix}
                <span className="flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="tabular text-xs text-fg-subtle">{o.count}</span>}
              </button>
            );
          })}
          {!shown.length && <p className="px-3 py-6 text-center text-sm text-fg-muted">—</p>}
        </div>
        <div className="flex items-center justify-between border-t border-border p-2">
          <button onClick={() => setDraft(new Set())} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg">
            {t("explorer.reset")}
          </button>
          <PopoverClose asChild>
            <button
              onClick={() => update({ [param]: [...draft].join(",") || null })}
              className="rounded-lg bg-fg px-3.5 py-1.5 text-sm font-medium text-bg hover:opacity-90"
            >
              {t("explorer.apply")}
            </button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Bereikfilter met presets en eigen min/max, opgeslagen als `min-max`. */
export function RangeFilter({
  param,
  label,
  icon,
  presets,
  format,
}: {
  param: string;
  label: string;
  icon: React.ReactNode;
  presets: { label: string; value: string }[];
  format?: (v: string) => string;
}) {
  const t = useT();
  const { update, searchParams } = useUpdateParams();
  const current = searchParams.get(param) ?? "";
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const summary = current ? (presets.find((p) => p.value === current)?.label ?? (format ? format(current) : current)) : undefined;

  return (
    <Popover
      onOpenChange={(open) => {
        if (open) {
          const [a = "", b = ""] = current.split("-");
          setMin(a);
          setMax(b);
        }
      }}
    >
      <PopoverTrigger className="rounded-full focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
        <Chip label={label} icon={icon} active={!!current} summary={summary} />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid grid-cols-2 gap-1.5">
          {presets.map((p) => (
            <PopoverClose asChild key={p.value}>
              <button
                onClick={() => update({ [param]: p.value })}
                className={cn(
                  "rounded-lg border px-2.5 py-2 text-left text-sm transition",
                  current === p.value ? "border-accent bg-accent-soft font-medium text-accent-strong" : "border-border hover:bg-surface-hover",
                )}
              >
                {p.label}
              </button>
            </PopoverClose>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.-]/g, ""))} placeholder={t("explorer.min")} inputMode="numeric" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:ring-2 focus:ring-accent/25 focus:outline-none" />
          <span className="text-fg-subtle">–</span>
          <input value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.-]/g, ""))} placeholder={t("explorer.max")} inputMode="numeric" className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:ring-2 focus:ring-accent/25 focus:outline-none" />
        </div>
        <div className="mt-3 flex items-center justify-between">
          <PopoverClose asChild>
            <button onClick={() => update({ [param]: null })} className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:bg-surface-hover hover:text-fg">
              {t("explorer.reset")}
            </button>
          </PopoverClose>
          <PopoverClose asChild>
            <button onClick={() => update({ [param]: min || max ? `${min}-${max}` : null })} className="rounded-lg bg-fg px-3.5 py-1.5 text-sm font-medium text-bg hover:opacity-90">
              {t("explorer.apply")}
            </button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Enkele keuze, bv. aanmaakdatum of minimale groei. */
export function SelectFilter({ param, label, icon, options }: { param: string; label: string; icon: React.ReactNode; options: Option[] }) {
  const t = useT();
  const { update, searchParams } = useUpdateParams();
  const current = searchParams.get(param);
  const summary = options.find((o) => o.value === current)?.label;
  return (
    <Popover>
      <PopoverTrigger className="rounded-full focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none">
        <Chip label={label} icon={icon} active={!!current} summary={summary} />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1.5">
        {options.map((o) => (
          <PopoverClose asChild key={o.value}>
            <button onClick={() => update({ [param]: o.value })} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-hover">
              {o.label}
              {current === o.value && <Check className="size-4 text-accent" />}
            </button>
          </PopoverClose>
        ))}
        {current && (
          <>
            <div className="my-1 h-px bg-border" />
            <PopoverClose asChild>
              <button onClick={() => update({ [param]: null })} className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-fg-muted hover:bg-surface-hover">
                {t("explorer.reset")}
              </button>
            </PopoverClose>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ClearFilters({ params, label }: { params: string[]; label: string }) {
  const { update } = useUpdateParams();
  return (
    <button onClick={() => update(Object.fromEntries(params.map((p) => [p, null])))} className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-fg-muted hover:bg-bg-subtle hover:text-fg">
      <X className="size-4" /> {label}
    </button>
  );
}

/** Klapt extra filters in/uit ("6 meer"). */
export function MoreFilters({ children, moreLabel, lessLabel }: { children: React.ReactNode; moreLabel: string; lessLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && children}
      <button onClick={() => setOpen(!open)} className="h-9 px-2 text-sm font-medium text-fg-muted hover:text-fg">
        {open ? lessLabel : moreLabel}
      </button>
    </>
  );
}

export function SortSelect({ options, label }: { options: Option[]; label: string }) {
  const { update, searchParams } = useUpdateParams();
  const current = searchParams.get("sort") ?? options[0]!.value;
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[15px] hover:bg-bg-subtle">
        <span className="text-fg-muted">{label}:</span>
        <span className="font-semibold text-fg">{options.find((o) => o.value === current)?.label}</span>
        <ChevronDown className="size-4 text-fg-muted" />
      </PopoverTrigger>
      <PopoverContent className="w-60 p-1.5">
        {options.map((o) => (
          <PopoverClose asChild key={o.value}>
            <button onClick={() => update({ sort: o.value === options[0]!.value ? null : o.value })} className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-hover">
              {o.label}
              {current === o.value && <Check className="size-4 text-accent" />}
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function ViewToggle({ options }: { options: { value: string; icon: React.ReactNode; label: string }[] }) {
  const { update, searchParams } = useUpdateParams();
  const current = searchParams.get("layout") ?? options[0]!.value;
  return (
    <div className="flex items-center rounded-xl bg-bg-subtle p-1">
      {options.map((o) => (
        <button
          key={o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => update({ layout: o.value === options[0]!.value ? null : o.value }, { keepPage: true })}
          className={cn("grid h-8 w-10 place-items-center rounded-lg transition [&_svg]:size-4", current === o.value ? "bg-surface text-fg shadow-sm" : "text-fg-muted hover:text-fg")}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, total, pageSize, labels }: { page: number; total: number; pageSize: number; labels: { prev: string; next: string; page: string } }) {
  const { update } = useUpdateParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-1 py-4">
      <span className="text-sm text-fg-muted">{labels.page}</span>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => update({ page: String(page - 1) })} className="h-9 rounded-xl border border-border bg-surface px-3.5 text-sm font-medium shadow-sm hover:bg-surface-hover disabled:opacity-40">
          {labels.prev}
        </button>
        <button disabled={page >= pages} onClick={() => update({ page: String(page + 1) })} className="h-9 rounded-xl border border-border bg-surface px-3.5 text-sm font-medium shadow-sm hover:bg-surface-hover disabled:opacity-40">
          {labels.next}
        </button>
      </div>
    </div>
  );
}
