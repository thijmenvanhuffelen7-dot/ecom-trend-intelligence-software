import { z } from "zod";

/**
 * Alertregels (no-code builder). Elke soort is een vaste, uitlegbare vraag aan de data;
 * de parameters zijn begrensd zodat een regel nooit "alles" of "niets" kan betekenen.
 */
export const RULE_KINDS = ["score_threshold", "phase_change", "store_new_products", "advertiser_new_ads", "keyword_growth", "competitor_price_drop", "new_store_launch"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

const scope = z.enum(["watchlist", "all"]).default("watchlist");

export const AlertRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("score_threshold"),
    metric: z.enum(["validation", "opportunity", "growth_velocity"]),
    op: z.enum(["gt", "lt"]).default("gt"),
    value: z.number().min(-100).max(1000),
    scope,
    niches: z.array(z.string().max(40)).max(12).default([]),
  }),
  z.object({ kind: z.literal("phase_change"), to: z.array(z.enum(["emerging", "rising", "peak", "saturated", "declining"])).min(1), scope }),
  z.object({ kind: z.literal("store_new_products"), min: z.number().int().min(1).max(500), days: z.number().int().min(1).max(30).default(7), scope }),
  z.object({ kind: z.literal("advertiser_new_ads"), min: z.number().int().min(1).max(500), days: z.number().int().min(1).max(30).default(7), scope }),
  z.object({
    kind: z.literal("keyword_growth"),
    pct: z.number().min(1).max(10_000),
    window: z.enum(["7d", "30d"]).default("7d"),
    keywordKind: z.enum(["keyword", "hashtag"]).default("keyword"),
  }),
  z.object({ kind: z.literal("competitor_price_drop"), pct: z.number().min(1).max(90), scope: z.literal("watchlist").default("watchlist") }),
  z.object({ kind: z.literal("new_store_launch"), niches: z.array(z.string().max(40)).max(12).default([]) }),
]);
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const CHANNEL_TYPES = ["email", "slack", "discord", "telegram", "webhook"] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Basiscontrole van een uitgaande URL (de worker controleert bij verzenden ook de DNS-resolutie op privé-adressen). */
export function checkOutboundUrl(raw: string, allowedHosts?: RegExp): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_url";
  }
  if (url.protocol !== "https:") return "https_only";
  if (url.username || url.password) return "no_credentials_in_url";
  const host = url.hostname.toLowerCase();
  if (PRIVATE_HOST.test(host) || IPV4.test(host) || host.startsWith("[") || host.includes(":")) return "public_host_only";
  if (url.port && url.port !== "443") return "port_443_only";
  if (allowedHosts && !allowedHosts.test(host)) return "unexpected_host";
  return null;
}

export const ChannelConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("email"), to: z.string().email().max(254) }),
  z.object({
    type: z.literal("slack"),
    url: z.string().max(500).refine((u) => checkOutboundUrl(u, /^hooks\.slack\.com$/) === null && /^https:\/\/hooks\.slack\.com\/services\//.test(u), "slack_webhook_url"),
  }),
  z.object({
    type: z.literal("discord"),
    url: z.string().max(500).refine((u) => checkOutboundUrl(u, /^(discord|discordapp)\.com$/) === null && /\/api\/webhooks\/\d+\//.test(u), "discord_webhook_url"),
  }),
  z.object({ type: z.literal("telegram"), botToken: z.string().regex(/^\d{5,15}:[A-Za-z0-9_-]{30,50}$/, "telegram_token"), chatId: z.string().regex(/^-?\d{3,20}$|^@[A-Za-z0-9_]{4,40}$/, "telegram_chat") }),
  z.object({
    type: z.literal("webhook"),
    url: z.string().max(500).refine((u) => checkOutboundUrl(u) === null, "public_https_url"),
    secret: z.string().min(16).max(128),
  }),
]);
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

/** Wat de UI van een kanaal mag tonen: nooit het geheim zelf. */
export function maskChannel(c: ChannelConfig): string {
  switch (c.type) {
    case "email":
      return c.to.replace(/^(.).*(@.*)$/, "$1…$2");
    case "telegram":
      return `chat ${c.chatId}`;
    default: {
      const u = new URL(c.url);
      return `${u.hostname}/…/${u.pathname.slice(-4)}`;
    }
  }
}
