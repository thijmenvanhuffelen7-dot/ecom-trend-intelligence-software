/** Helpers om URL-zoekparameters veilig te lezen (alles wat binnenkomt is onbetrouwbaar). */
export type SearchParams = Record<string, string | string[] | undefined>;

export function str(sp: SearchParams, key: string, max = 120): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s.slice(0, max) : undefined;
}

export function list(sp: SearchParams, key: string, allowed?: readonly string[]): string[] {
  const raw = str(sp, key, 2000);
  if (!raw) return [];
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
  return allowed ? items.filter((i) => allowed.includes(i)) : items;
}

export function num(sp: SearchParams, key: string): number | undefined {
  const raw = str(sp, key, 20);
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function range(sp: SearchParams, key: string): { min?: number; max?: number } {
  const raw = str(sp, key, 50);
  if (!raw) return {};
  const [a, b] = raw.split("-");
  const min = a ? Number(a) : undefined;
  const max = b ? Number(b) : undefined;
  return { min: Number.isFinite(min) ? min : undefined, max: Number.isFinite(max) ? max : undefined };
}

export function oneOf<T extends string>(sp: SearchParams, key: string, allowed: readonly T[], fallback: T): T {
  const v = str(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function page(sp: SearchParams): number {
  const n = num(sp, "page");
  return n && n >= 1 ? Math.min(Math.floor(n), 10_000) : 1;
}
