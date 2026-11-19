/**
 * Demo-media: deterministische SVG's voor productfoto's, shop-screenshots, ad-creatives en avatars.
 * Alleen voor de seed-dataset; echte media komen in productie uit S3/CDN.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function wrap(text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      out.push(cur.trim());
      cur = w;
      if (out.length === lines) break;
    } else cur += ` ${w}`;
  }
  if (out.length < lines && cur.trim()) out.push(cur.trim());
  if (out.length === lines && words.join(" ").length > out.join(" ").length) out[lines - 1] = `${out[lines - 1]!.replace(/[.,!?…]*$/, "")}…`;
  return out;
}

const EMOJI_FONT = "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif";
const SANS = "Geist, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

function product(p: URLSearchParams): string {
  const e = esc(p.get("e") ?? "📦");
  const h = Number(p.get("h") ?? 140);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <radialGradient id="g" cx="50%" cy="35%" r="75%">
      <stop offset="0" stop-color="hsl(${h} 70% 97%)"/><stop offset="1" stop-color="hsl(${h} 45% 88%)"/>
    </radialGradient>
  </defs>
  <rect width="200" height="200" fill="url(#g)"/>
  <ellipse cx="100" cy="158" rx="46" ry="8" fill="hsl(${h} 30% 40%)" opacity=".14"/>
  <text x="100" y="118" font-size="86" text-anchor="middle" font-family="${EMOJI_FONT}">${e}</text>
</svg>`;
}

function store(p: URLSearchParams): string {
  const name = esc(p.get("n") ?? "Store");
  const color = esc(p.get("c") ?? "hsl(150 50% 35%)");
  const e = esc(p.get("e") ?? "🛍️");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">
  <rect width="320" height="200" fill="#fff"/>
  <rect width="320" height="18" fill="${color}"/>
  <text x="160" y="12.5" font-size="7" fill="#fff" text-anchor="middle" font-family="${SANS}" font-weight="600" letter-spacing=".6">FREE SHIPPING ON ALL ORDERS</text>
  <text x="16" y="40" font-size="13" font-weight="800" fill="#111" font-family="${SANS}">${name}</text>
  <g fill="#9ca3af"><rect x="180" y="32" width="26" height="5" rx="2.5"/><rect x="214" y="32" width="26" height="5" rx="2.5"/><rect x="248" y="32" width="26" height="5" rx="2.5"/></g>
  <circle cx="296" cy="35" r="5" fill="none" stroke="#111" stroke-width="1.4"/>
  <rect x="0" y="54" width="320" height="104" fill="${color}" opacity=".12"/>
  <text x="18" y="88" font-size="17" font-weight="800" fill="#111" font-family="${SANS}">Feel the</text>
  <text x="18" y="108" font-size="17" font-weight="800" fill="${color}" font-family="${SANS}">difference.</text>
  <rect x="18" y="120" width="64" height="18" rx="9" fill="#111"/>
  <text x="50" y="132" font-size="7.5" fill="#fff" text-anchor="middle" font-family="${SANS}" font-weight="600">SHOP NOW</text>
  <text x="236" y="136" font-size="72" text-anchor="middle" font-family="${EMOJI_FONT}">${e}</text>
  <g fill="#f3f4f6"><rect x="16" y="168" width="66" height="32" rx="4"/><rect x="92" y="168" width="66" height="32" rx="4"/><rect x="168" y="168" width="66" height="32" rx="4"/><rect x="244" y="168" width="66" height="32" rx="4"/></g>
</svg>`;
}

function ad(p: URLSearchParams): string {
  const e = esc(p.get("e") ?? "✨");
  const color = esc(p.get("c") ?? "hsl(150 50% 35%)");
  const lines = wrap(p.get("t") ?? "", 22, 3).map(esc);
  const video = p.get("v") === "1";
  const text = lines
    .map((l, i) => `<text x="20" y="${44 + i * 22}" font-size="17" font-weight="800" fill="#fff" font-family="${SANS}">${l}</text>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 300">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#0b0c0d"/></linearGradient>
    <radialGradient id="glow" cx="50%" cy="60%" r="50%"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="240" height="300" fill="url(#bg)"/>
  <circle cx="120" cy="178" r="96" fill="url(#glow)"/>
  ${text}
  <text x="120" y="214" font-size="96" text-anchor="middle" font-family="${EMOJI_FONT}">${e}</text>
  <rect x="16" y="254" width="208" height="32" rx="10" fill="#fff" opacity=".96"/>
  <text x="120" y="275" font-size="11" font-weight="700" fill="#111" text-anchor="middle" font-family="${SANS}">Shop now →</text>
  ${video ? `<g transform="translate(206 18)"><circle r="13" fill="#000" opacity=".45"/><path d="M-4 -6 L7 0 L-4 6 Z" fill="#fff"/></g>` : ""}
</svg>`;
}

function avatar(p: URLSearchParams): string {
  const n = (p.get("n") ?? "?").replace(/[^a-z]/gi, "");
  const h = Number(p.get("h") ?? 200);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 80% 62%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360} 70% 45%)"/></linearGradient></defs>
  <rect width="64" height="64" rx="32" fill="url(#a)"/>
  <text x="32" y="40" font-size="22" font-weight="700" fill="#fff" text-anchor="middle" font-family="${SANS}">${esc(n.slice(0, 2).toUpperCase())}</text>
</svg>`;
}

const RENDERERS: Record<string, (p: URLSearchParams) => string> = {
  "product.svg": product,
  "store.svg": store,
  "ad.svg": ad,
  "avatar.svg": avatar,
};

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const render = RENDERERS[(await params).file];
  if (!render) return new Response("Not found", { status: 404 });
  return new Response(render(new URL(req.url).searchParams), {
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable" },
  });
}
