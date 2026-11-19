import { cn } from "@/lib/utils";
import type { Phase } from "@trendscope/core";

export function scoreTone(v: number): string {
  if (v >= 70) return "var(--accent)";
  if (v >= 45) return "#84cc16";
  if (v >= 25) return "var(--warning)";
  return "var(--danger)";
}

/** Ringmeter 0–100. */
export function ScoreRing({ value, size = 40, stroke = 4, label, className }: { value: number; size?: number; stroke?: number; label?: string; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={scoreTone(v)}
          strokeWidth={stroke}
          strokeDasharray={`${(v / 100) * c} ${c}`}
          strokeLinecap="round"
        />
      </svg>
      <span className="tabular absolute font-semibold text-fg" style={{ fontSize: size * 0.3 }}>
        {label ?? Math.round(v)}
      </span>
    </div>
  );
}

/** Horizontale meter, bv. voor saturatie (hoog = slecht → `invert`). */
export function Meter({ value, invert = false, className }: { value: number; invert?: boolean; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle", className)}>
      <div className="h-full rounded-full" style={{ width: `${v}%`, background: scoreTone(invert ? 100 - v : v) }} />
    </div>
  );
}

const PHASE_STYLE: Record<Phase, { dot: string; cls: string }> = {
  emerging: { dot: "#8e4ec6", cls: "bg-[#f5effc] text-[#7b3fb3] dark:bg-[#251b31] dark:text-[#c79cf0]" },
  rising: { dot: "var(--accent)", cls: "bg-accent-soft text-accent-strong" },
  peak: { dot: "var(--warning)", cls: "bg-warning-soft text-[#b45309] dark:text-warning" },
  saturated: { dot: "var(--fg-subtle)", cls: "bg-bg-subtle text-fg-muted" },
  declining: { dot: "var(--danger)", cls: "bg-danger-soft text-danger" },
};

export function PhaseBadge({ phase, label, className }: { phase: Phase; label: string; className?: string }) {
  const s = PHASE_STYLE[phase];
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap", s.cls, className)}>
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {label}
    </span>
  );
}

export const PHASE_COLORS: Record<Phase, string> = Object.fromEntries(
  Object.entries(PHASE_STYLE).map(([k, v]) => [k, v.dot]),
) as Record<Phase, string>;
