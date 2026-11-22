import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM voor kanaalsecrets. Formaat (identiek in workers/src/trendscope/core/crypto.py):
 *   "v1:" + base64(iv[12] ‖ ciphertext ‖ tag[16])
 * Sleutel: APP_ENCRYPTION_KEY (32 bytes, base64). Alleen buiten productie mag hij uit AUTH_SECRET worden afgeleid.
 */
function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY moet 32 bytes (base64) zijn");
    return k;
  }
  if (process.env.NODE_ENV === "production" && process.env.AUTH_MODE === "clerk") throw new Error("APP_ENCRYPTION_KEY ontbreekt");
  return createHash("sha256").update(`trendscope-dev:${process.env.AUTH_SECRET ?? ""}`).digest();
}

export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64")}`;
}

export function decryptJson<T>(token: string): T {
  if (!token.startsWith("v1:")) throw new Error("Onbekend formaat");
  const buf = Buffer.from(token.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8")) as T;
}
