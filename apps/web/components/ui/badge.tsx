import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-bg-subtle text-fg-muted border-border",
  accent: "bg-accent-soft text-accent-strong border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
  warning: "bg-warning-soft text-[#b45309] dark:text-warning border-transparent",
  info: "bg-info-soft text-info border-transparent",
  outline: "bg-surface text-fg border-border",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Groei-chip: "↗ +12%" in groen, "↘ −4%" in rood. */
export function DeltaBadge({ value, className, suffix = "%" }: { value: number | null | undefined; className?: string; suffix?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      className={cn(
        "tabular inline-flex h-5 items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 text-[11.5px] font-semibold",
        up ? "bg-accent-soft text-accent-strong" : "bg-danger-soft text-danger",
        className,
      )}
    >
      {up ? "↗" : "↘"} {value > 999 ? "" : up ? "+" : "−"}
      {/* boven 999% is het getal betekenisloos (bv. een winkel die net live ging) */}
      {up && value > 999 ? ">999" : Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}
      {suffix}
    </span>
  );
}
