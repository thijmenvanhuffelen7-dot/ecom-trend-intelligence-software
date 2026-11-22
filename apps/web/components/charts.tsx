"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { EChartsOption } from "echarts";

const ReactECharts = dynamic(() => import("echarts-for-react"), {
  ssr: false,
  loading: () => <div className="skeleton size-full rounded-xl" />,
});

type Palette = Record<"fg" | "muted" | "subtle" | "grid" | "border" | "surface" | "accent" | "c2" | "c3" | "c4" | "c5" | "c6", string>;

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    fg: v("--fg"), muted: v("--fg-muted"), subtle: v("--fg-subtle"), grid: v("--chart-grid"), border: v("--border"),
    surface: v("--surface"), accent: v("--chart-1"), c2: v("--chart-2"), c3: v("--chart-3"), c4: v("--chart-4"),
    c5: v("--chart-5"), c6: v("--chart-6"),
  };
}

/** Herleest het palet als het thema wisselt. */
function usePalette(): Palette | null {
  const [p, setP] = useState<Palette | null>(null);
  useEffect(() => {
    setP(readPalette());
    const obs = new MutationObserver(() => setP(readPalette()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return p;
}

function Chart({ option, height }: { option: EChartsOption; height: number }) {
  return (
    <div style={{ height }}>
      <ReactECharts option={option} style={{ height: "100%", width: "100%" }} opts={{ renderer: "svg" }} notMerge lazyUpdate />
    </div>
  );
}

const fontFamily = "var(--font-geist-sans), ui-sans-serif, system-ui";

function base(p: Palette, locale: string): EChartsOption {
  return {
    textStyle: { fontFamily, color: p.muted },
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: "#111214",
      borderWidth: 0,
      padding: [8, 12],
      textStyle: { color: "#fff", fontSize: 12, fontFamily },
      axisPointer: { type: "line", lineStyle: { color: p.border } },
      valueFormatter: (v) => (typeof v === "number" ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v) : String(v)),
    },
    xAxis: {
      type: "time",
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: p.subtle, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: p.grid } },
      axisLabel: {
        color: p.subtle,
        fontSize: 11,
        formatter: (v: number) => new Intl.NumberFormat(locale, { notation: "compact" }).format(v),
      },
    },
  };
}

export interface Series {
  name: string;
  points: [string, number][];
  color?: keyof Palette;
}

export function AreaChart({ series, height = 260, locale = "en", stacked = false }: { series: Series[]; height?: number; locale?: string; stacked?: boolean }) {
  const p = usePalette();
  if (!p) return <div className="skeleton rounded-xl" style={{ height }} />;
  const defaults: (keyof Palette)[] = ["accent", "c2", "c3", "c4", "c5", "c6"];
  const option: EChartsOption = {
    ...base(p, locale),
    legend: series.length > 1 ? { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: p.muted, fontSize: 12 } } : undefined,
    grid: { left: 8, right: 12, top: series.length > 1 ? 32 : 16, bottom: 8, containLabel: true },
    series: series.map((s, i) => {
      const color = p[s.color ?? defaults[i % defaults.length]!];
      return {
        type: "line",
        name: s.name,
        data: s.points,
        smooth: 0.35,
        showSymbol: false,
        stack: stacked ? "total" : undefined,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: `${color}33` }, { offset: 1, color: `${color}00` }],
          },
        },
      };
    }),
  };
  return <Chart option={option} height={height} />;
}

export function DonutChart({ data, height = 200, locale = "en" }: { data: { name: string; value: number }[]; height?: number; locale?: string }) {
  const p = usePalette();
  if (!p) return <div className="skeleton rounded-full" style={{ height, width: height }} />;
  const colors = [p.accent, p.c6, p.c2, p.c3, p.c4, p.c5, p.subtle];
  const option: EChartsOption = {
    tooltip: {
      trigger: "item",
      backgroundColor: "#111214",
      borderWidth: 0,
      textStyle: { color: "#fff", fontSize: 12, fontFamily },
      valueFormatter: (v) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(v))}%`,
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "88%"],
        padAngle: 2,
        itemStyle: { borderRadius: 4 },
        label: { show: false },
        data: data.map((d, i) => ({ ...d, itemStyle: { color: colors[i % colors.length] } })),
      },
    ],
  };
  return <Chart option={option} height={height} />;
}

/** ECharts begrijpt geen CSS-variabelen: zet `var(--x)` om naar de huidige waarde. */
function resolveColor(c: string | undefined): string | undefined {
  const m = c?.match(/^var\((--[\w-]+)\)$/);
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]!).trim() : c;
}

export const DONUT_COLOR_VARS = ["--chart-1", "--chart-6", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--fg-subtle"];

export function BarChart({
  data,
  height = 220,
  locale = "en",
  colors,
  max,
}: {
  data: { name: string; value: number }[];
  height?: number;
  locale?: string;
  colors?: string[];
  max?: number;
}) {
  const p = usePalette();
  if (!p) return <div className="skeleton rounded-xl" style={{ height }} />;
  const option: EChartsOption = {
    ...base(p, locale),
    tooltip: { ...(base(p, locale).tooltip as object), trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: `${p.grid}` } } },
    xAxis: { type: "category", data: data.map((d) => d.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: p.muted, fontSize: 11, interval: 0 } },
    yAxis: { type: "value", max, splitLine: { lineStyle: { color: p.grid } }, axisLabel: { color: p.subtle, fontSize: 11 } },
    series: [
      {
        type: "bar",
        barMaxWidth: 34,
        data: data.map((d, i) => ({ value: d.value, itemStyle: { color: resolveColor(colors?.[i]) ?? p.accent, borderRadius: [6, 6, 2, 2] } })),
      },
    ],
  };
  return <Chart option={option} height={height} />;
}

export interface ForecastPoint {
  d: string;
  v: number;
  lo: number;
  hi: number;
}

/** Historie (lijn) + verwachting (stippellijn) met een ~90%-onzekerheidsband. */
export function ForecastChart({
  history,
  forecast,
  labels,
  height = 260,
  locale = "en",
}: {
  history: [string, number][];
  forecast: ForecastPoint[];
  labels: { actual: string; expected: string; band: string };
  height?: number;
  locale?: string;
}) {
  const p = usePalette();
  if (!p) return <div className="skeleton rounded-xl" style={{ height }} />;
  const last = history.at(-1);
  // De verwachting begint bij het laatste gemeten punt, zodat de lijnen aansluiten
  const fc: [string, number][] = [...(last ? [last] : []), ...forecast.map((f) => [f.d, f.v] as [string, number])];
  const option: EChartsOption = {
    ...base(p, locale),
    legend: { top: 0, right: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { color: p.muted, fontSize: 12 }, data: [labels.actual, labels.expected, labels.band] },
    grid: { left: 8, right: 12, top: 32, bottom: 8, containLabel: true },
    series: [
      { type: "line", name: "lo", data: forecast.map((f) => [f.d, f.lo]), stack: "band", lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
      {
        type: "line",
        name: labels.band,
        data: forecast.map((f) => [f.d, Math.max(0, f.hi - f.lo)]),
        stack: "band",
        lineStyle: { opacity: 0 },
        showSymbol: false,
        areaStyle: { color: `${p.c2}26` },
        itemStyle: { color: `${p.c2}55` },
        tooltip: { show: false },
      },
      { type: "line", name: labels.actual, data: history, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: p.accent }, itemStyle: { color: p.accent } },
      { type: "line", name: labels.expected, data: fc, smooth: 0.3, showSymbol: false, lineStyle: { width: 2, type: "dashed", color: p.c2 }, itemStyle: { color: p.c2 } },
    ],
  };
  return <Chart option={option} height={height} />;
}
