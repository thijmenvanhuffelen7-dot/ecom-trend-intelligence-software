"use client";

import { useState } from "react";
import { AreaChart, type Series } from "@/components/charts";
import { cn } from "@/lib/utils";

const PERIODS = [
  { key: "1m", days: 30 },
  { key: "3m", days: 90 },
  { key: "6m", days: 182 },
  { key: "1y", days: 366 },
] as const;

/** Tijdreeks met periodekeuze; aggregeert naar week bij lange periodes voor een rustige lijn. */
export function PeriodChart({ series, locale, height = 250, defaultPeriod = "1y", weekly = true }: { series: Series[]; locale: string; height?: number; defaultPeriod?: (typeof PERIODS)[number]["key"]; weekly?: boolean }) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>(defaultPeriod);
  const days = PERIODS.find((p) => p.key === period)!.days;
  const sliced = series.map((s) => {
    const pts = s.points.slice(-days);
    if (!weekly || days <= 90) return { ...s, points: pts };
    const out: [string, number][] = [];
    for (let i = 0; i < pts.length; i += 7) {
      const chunk = pts.slice(i, i + 7);
      out.push([chunk[0]![0], chunk.reduce((a, p) => a + p[1], 0) / chunk.length]);
    }
    return { ...s, points: out };
  });
  return (
    <div>
      <div className="mb-2 flex gap-1">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={cn("h-7 rounded-lg px-2.5 text-xs font-semibold transition", period === p.key ? "bg-fg text-bg" : "text-fg-muted hover:bg-bg-subtle hover:text-fg")}
          >
            {p.key}
          </button>
        ))}
      </div>
      <AreaChart series={sliced} locale={locale} height={height} />
    </div>
  );
}
