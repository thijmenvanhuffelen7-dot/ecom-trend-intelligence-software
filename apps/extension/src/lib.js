// Gedeelde, pure logica (getest met vitest). Geen toegang tot paginainhoud: we gebruiken alleen de hostnaam van het tabblad.

export const DEFAULT_BASE = "https://app.trendscope.example";
export const CACHE_TTL_MS = 10 * 60 * 1000;

/** Hostnaam van een tab-URL, genormaliseerd zoals de crawler (zonder "www."); null voor alles wat geen publieke webshop is. */
export function hostnameOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".local") || host === "localhost") return null;
  return host;
}

/** Basis-URL van de Trendscope-app valideren (alleen https, behalve localhost voor ontwikkeling). */
export function normalizeBase(input) {
  let u;
  try {
    u = new URL(String(input || "").trim());
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
  return u.origin;
}

export const originPattern = (base) => `${new URL(base).origin}/*`;
export const isValidKey = (key) => /^ts_live_[0-9A-Za-z]{32}$/.test(String(key || "").trim());

export function isFresh(entry, now = Date.now(), ttl = CACHE_TTL_MS) {
  return !!entry && typeof entry.at === "number" && now - entry.at < ttl;
}

/** Zoekt een winkel op via de publieke API. Geeft altijd een object met `status` terug, gooit niet. */
export async function lookupStore(fetchImpl, base, key, domain) {
  let res;
  try {
    res = await fetchImpl(`${base}/api/v1/stores/lookup?domain=${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
  } catch {
    return { status: "error", message: "network" };
  }
  if (res.status === 404) return { status: "not_found" };
  if (res.status === 401) return { status: "unauthorized" };
  if (res.status === 403) return { status: "forbidden" };
  if (res.status === 429) return { status: "rate_limited" };
  if (!res.ok) return { status: "error", message: String(res.status) };
  try {
    const body = await res.json();
    return { status: "ok", store: body.data };
  } catch {
    return { status: "error", message: "parse" };
  }
}

/** Badge op het extensie-icoon: opportuniteit van het sterkste product, of ✓ als we de winkel kennen. */
export function badgeFor(result) {
  if (!result || result.status !== "ok") return { text: "", color: "#6c7076" };
  const top = result.store?.top_products?.[0]?.opportunity;
  if (typeof top === "number") return { text: String(Math.round(top)), color: top >= 70 ? "#1fb95a" : top >= 50 ? "#e5a50a" : "#6c7076" };
  return { text: "✓", color: "#1fb95a" };
}

export function formatCompact(n, locale = "nl-NL") {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Bandbreedte van een schatting, altijd met "≈" zodat niemand het voor een exact getal aanziet. */
export function formatEstimate(est, locale = "nl-NL", currency) {
  if (!est || typeof est.value !== "number") return "—";
  const f = (v) => (currency ? `€${formatCompact(v, locale)}` : formatCompact(v, locale));
  return typeof est.low === "number" && typeof est.high === "number" && est.low !== est.high ? `≈ ${f(est.low)}–${f(est.high)}` : `≈ ${f(est.value)}`;
}
