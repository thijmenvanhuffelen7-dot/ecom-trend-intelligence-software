import { cn, flagEmoji } from "@/lib/utils";

export function Flag({ country, className }: { country: string | null | undefined; className?: string }) {
  return (
    <span className={cn("inline-block text-[15px] leading-none", className)} title={country ?? undefined} aria-label={country ?? undefined}>
      {flagEmoji(country)}
    </span>
  );
}

/** Overlappende vlaggen, zoals bezoekerslanden in de shoptabel. */
export function FlagStack({ countries, max = 3 }: { countries: string[]; max?: number }) {
  return (
    <span className="inline-flex items-center -space-x-1">
      {countries.slice(0, max).map((c) => (
        <span key={c} className="grid size-[18px] place-items-center rounded-full bg-surface text-[13px] ring-2 ring-surface" title={c}>
          {flagEmoji(c)}
        </span>
      ))}
    </span>
  );
}

export function Thumb({ src, alt, className, rounded = "rounded-xl" }: { src: string | null | undefined; alt: string; className?: string; rounded?: string }) {
  return (
    <div className={cn("relative shrink-0 overflow-hidden border border-border bg-bg-subtle", rounded, className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
      ) : null}
    </div>
  );
}

export function EmptyState({ icon, title, hint, action }: { icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      {icon && <div className="grid size-12 place-items-center rounded-2xl bg-bg-subtle text-fg-muted [&_svg]:size-5">{icon}</div>}
      <div>
        <p className="text-[15px] font-semibold text-fg">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-border bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">{children}</kbd>;
}

/** Schermafbeelding van een winkel, of een merk-tegel zolang er nog geen screenshot is. */
export function ShopThumb({ src, name, color, className, rounded = "rounded-lg" }: { src: string | null | undefined; name: string; color?: string | null; className?: string; rounded?: string }) {
  if (src) return <Thumb src={src} alt={name} className={className} rounded={rounded} />;
  if (!color) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
    color = `hsl(${h} 55% 40%)`;
  }
  return (
    <div
      className={cn("relative grid shrink-0 place-items-center overflow-hidden border border-border", rounded, className)}
      style={{ background: `linear-gradient(135deg, ${color ?? "var(--accent)"} 0%, color-mix(in oklab, ${color ?? "var(--accent)"} 55%, black) 100%)` }}
      aria-label={name}
    >
      <span className="text-lg font-bold tracking-tight text-white/95">{name.slice(0, 1).toUpperCase()}</span>
      <span className="absolute inset-x-2 bottom-1.5 h-1 rounded-full bg-white/25" />
    </div>
  );
}
