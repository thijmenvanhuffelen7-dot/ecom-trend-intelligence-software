import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** API-sleutels: `ts_live_` + 32 tekens base62. We bewaren alleen het prefix (zichtbaar) en de sha256. */
export const KEY_PREFIX = "ts_live_";
export const API_SCOPES = ["read:products", "read:stores", "read:trends", "read:leads", "extension"] as const;
/** `extension`: alleen winkel-lookup per domein (Chrome-extensie); op elk plan met de flag chrome_extension, buiten het API-quotum. */
export type ApiScope = (typeof API_SCOPES)[number];

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateKey(): { key: string; prefix: string; hash: string } {
  const bytes = randomBytes(32);
  let body = "";
  for (const b of bytes) body += ALPHABET[b % 62]; // 256 % 62 geeft een minimale bias; 32 tekens ≈ 190 bits
  const key = `${KEY_PREFIX}${body}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 8), hash: hashKey(key) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function parseKey(header: string | null): { key: string; prefix: string } | null {
  const m = header?.match(/^Bearer\s+(ts_live_[0-9A-Za-z]{32})$/);
  if (!m) return null;
  return { key: m[1]!, prefix: m[1]!.slice(0, KEY_PREFIX.length + 8) };
}

export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
