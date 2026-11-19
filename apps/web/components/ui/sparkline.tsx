import { cn } from "@/lib/utils";

/** Lichtgewicht SVG-sparkline voor tabellen (geen chart-bibliotheek nodig). */
export function Sparkline({
  values,
  width = 150,
  height = 44,
  tone = "auto",
  className,
  fill = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "auto" | "accent" | "danger" | "muted" | "info";
  className?: string;
  fill?: boolean;
}) {
  if (values.length < 2) return <div style={{ width, height }} className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pad = 3;
  const pts: [number, number][] = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    pad + (1 - (v - min) / range) * (height - pad * 2),
  ]);
  // vloeiende curve (Catmull-Rom → Bézier)
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const first = values.slice(0, Math.ceil(values.length / 4)).reduce((a, b) => a + b, 0);
  const last = values.slice(-Math.ceil(values.length / 4)).reduce((a, b) => a + b, 0);
  const resolved = tone === "auto" ? (last >= first ? "accent" : "danger") : tone;
  const color = { accent: "var(--accent)", danger: "var(--danger)", muted: "var(--fg-subtle)", info: "var(--info)" }[resolved];
  const id = `sl-${Math.round(values.reduce((a, b) => a + b, 0) * 1000) % 1e9}-${values.length}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={cn("overflow-visible", className)} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity="0.22" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
