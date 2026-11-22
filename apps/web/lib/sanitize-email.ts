/**
 * Maakt marketing-HTML veilig om te tonen: geen scripts, frames, formulieren of event-handlers, geen trackingpixels,
 * en externe afbeeldingen pas na een klik (anders ziet de afzender wie de mail opent). Het resultaat wordt bovendien
 * getoond in een sandbox-iframe zonder scripts en zonder same-origin: dit is een tweede verdedigingslinie, niet de enige.
 */
export function sanitizeEmailHtml(html: string, { images }: { images: boolean }): string {
  let out = html
    // 1. complete blokken met inhoud
    .replace(/<\s*(script|iframe|object|embed|form|frameset|noscript|template|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    // 2. losse/ongesloten gevaarlijke tags
    .replace(/<\s*\/?\s*(script|iframe|object|embed|form|frame|frameset|meta|link|base|input|button|textarea|select)\b[^>]*>/gi, "")
    // 3. event-handlers en javascript:/data:-URL's
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*(["'])\s*(javascript|vbscript|data):[^"']*\2/gi, ' $1="#"')
    .replace(/expression\s*\(/gi, "x(")
    // 4. 1×1-trackingpixels
    .replace(/<img\b[^>]*\b(width|height)\s*=\s*["']?1(px)?["']?[^>]*>/gi, "");
  if (!images) out = out.replace(/(<img\b[^>]*?)\ssrc\s*=\s*(["'])(https?:[^"']*)\2/gi, "$1 data-blocked-src=$2$3$2");
  return `<base target="_blank">${out}`;
}
