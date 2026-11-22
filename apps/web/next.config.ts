import type { NextConfig } from "next";

const dev = process.env.NODE_ENV === "development";
const clerk = process.env.AUTH_MODE === "clerk";
const clerkHosts = clerk ? " https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com" : "";

/**
 * Content-Security-Policy. Next.js gebruikt inline scripts voor hydration, dus 'unsafe-inline' is (zonder nonces) nodig;
 * de winst zit in de rest: geen externe scripts, geen framing van onze pagina's, geen form-posts naar elders.
 * img-src staat https: toe omdat productbeelden en e-mails van winkel-CDN's komen.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}${clerkHosts}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${clerkHosts}${dev ? " ws:" : ""}`,
  `frame-src 'self'${clerkHosts}`,
  "frame-ancestors 'none'",
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  transpilePackages: ["@trendscope/db", "@trendscope/core"],
  serverExternalPackages: ["pg", "@clickhouse/client"],
  typedRoutes: false,
  poweredByHeader: false,
  devIndicators: false,
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: "/api/v1/openapi.json", destination: "/api/v1/openapi" }];
  },
};

export default config;
