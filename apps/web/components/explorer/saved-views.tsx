"use client";

import { Crown, Flame, Gem, Rocket, Store, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateParams } from "./use-params";

const ICONS: Record<string, LucideIcon> = { gem: Gem, "trending-up": TrendingUp, crown: Crown, flame: Flame, rocket: Rocket };

export function SavedViews({ views, allLabel }: { views: { slug: string; label: string; icon: string | null }[]; allLabel: string }) {
  const { update, searchParams } = useUpdateParams();
  const current = searchParams.get("view");
  const items = [{ slug: null as string | null, label: allLabel, icon: "store" }, ...views];
  return (
    <div className="flex items-center justify-center gap-1.5 overflow-x-auto px-1 py-1">
      {items.map((v) => {
        const Icon = v.icon === "store" ? Store : (ICONS[v.icon ?? ""] ?? Gem);
        const active = current === v.slug || (!current && v.slug === null);
        return (
          <button
            key={v.slug ?? "all"}
            onClick={() => update({ view: v.slug })}
            className={cn(
              "flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium whitespace-nowrap transition",
              active ? "bg-surface text-fg shadow-md ring-1 ring-border" : "text-fg-muted hover:bg-bg-subtle hover:text-fg",
            )}
          >
            <Icon className={cn("size-4", active ? "text-accent" : "text-accent/80")} />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
