/**
 * Ondertekende sessietokens voor de lokale dev-auth. Gebruikt Web Crypto, zodat dezelfde code
 * in middleware (edge) en in server components (Node) draait.
 */
export const SESSION_COOKIE = "ts_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface SessionPayload {
  email: string;
  iat: number;
  exp: number;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("AUTH_SECRET moet minimaal 32 tekens zijn");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(email: string, secret: string, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { email, iat, exp: iat + MAX_AGE_SECONDS };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as SessionPayload;
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export const sessionMaxAge = MAX_AGE_SECONDS;
