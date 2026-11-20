import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCompact(n: number | null | undefined, locale = "en"): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function formatNumber(n: number | null | undefined, locale = "en"): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(locale).format(Math.round(n));
}

export function formatMoney(n: number | null | undefined, currency = "EUR", locale = "en", compact = false): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
  }).format(n);
}

export function formatPct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatDate(d: string | Date | null | undefined, locale = "en"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(d: string | Date | null | undefined, locale = "en"): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

/** "2 jr 3 mnd" / "2 yr 3 mo" */
export function formatAge(d: string | Date | null | undefined, locale = "en", today = new Date()): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const months = (today.getFullYear() - date.getFullYear()) * 12 + today.getMonth() - date.getMonth();
  const y = Math.floor(months / 12);
  const m = months % 12;
  const nl = locale.startsWith("nl");
  if (months <= 0 || (months === 1 && today.getDate() < date.getDate())) {
    const days = Math.max(0, Math.floor((today.getTime() - date.getTime()) / 86_400_000));
    return nl ? `${days} ${days === 1 ? "dag" : "dagen"}` : `${days} ${days === 1 ? "day" : "days"}`;
  }
  const yr = nl ? "jr" : "yr";
  const mo = nl ? "mnd" : "mo";
  if (y === 0) return `${Math.max(m, 0)} ${mo}`;
  return m === 0 ? `${y} ${yr}` : `${y} ${yr} ${m} ${mo}`;
}

export function daysBetween(a: string | Date, b: string | Date = new Date()): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86_400_000));
}

export function flagEmoji(country: string | null | undefined): string {
  if (!country || country.length !== 2) return "🏳️";
  return String.fromCodePoint(...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
