import { cn } from "@/lib/utils";

/** Trendscope-merkteken: een vizier met een stijgende lijn. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("size-10", className)} aria-hidden>
      <rect width="40" height="40" rx="12" fill="var(--accent)" />
      <circle cx="20" cy="20" r="11" fill="none" stroke="#0b0c0d" strokeWidth="2.6" opacity=".9" />
      <path d="M11.5 25.5 L17 19.5 L21 22.5 L28.5 13.5" fill="none" stroke="#0b0c0d" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28.5" cy="13.5" r="2.4" fill="#0b0c0d" />
    </svg>
  );
}

export function Logo({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8" />
      <span className={cn("text-[17px] font-bold tracking-tight", light ? "text-white" : "text-fg")}>Trendscope</span>
    </span>
  );
}
