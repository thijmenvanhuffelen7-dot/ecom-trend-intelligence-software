import { describe, expect, it } from "vitest";
import { AlertRuleSchema, ChannelConfigSchema, checkOutboundUrl, maskChannel } from "./alerts";

describe("alert rules", () => {
  it("applies defaults and bounds", () => {
    const r = AlertRuleSchema.parse({ kind: "score_threshold", metric: "validation", value: 70 });
    expect(r).toMatchObject({ op: "gt", scope: "watchlist", niches: [] });
    expect(() => AlertRuleSchema.parse({ kind: "store_new_products", min: 0 })).toThrow();
    expect(() => AlertRuleSchema.parse({ kind: "drop_database" })).toThrow();
  });
});

describe("outbound urls (SSRF)", () => {
  it.each([
    ["http://hooks.slack.com/services/x", "https_only"],
    ["https://127.0.0.1/hook", "public_host_only"],
    ["https://localhost/hook", "public_host_only"],
    ["https://[::1]/hook", "public_host_only"],
    ["https://metadata.google.internal/x", "public_host_only"],
    ["https://user:pw@example.com/x", "no_credentials_in_url"],
    ["https://example.com:8443/x", "port_443_only"],
    ["https://example.com/hook", null],
  ])("%s → %s", (url, expected) => {
    expect(checkOutboundUrl(url)).toBe(expected);
  });

  it("only accepts real Slack/Discord webhook hosts", () => {
    expect(ChannelConfigSchema.safeParse({ type: "slack", url: "https://hooks.slack.com/services/T0/B0/abc" }).success).toBe(true);
    expect(ChannelConfigSchema.safeParse({ type: "slack", url: "https://evil.example/services/T0" }).success).toBe(false);
    expect(ChannelConfigSchema.safeParse({ type: "discord", url: "https://discord.com/api/webhooks/123/abc" }).success).toBe(true);
    expect(ChannelConfigSchema.safeParse({ type: "webhook", url: "https://10.0.0.1/x", secret: "s".repeat(20) }).success).toBe(false);
  });

  it("never shows secrets", () => {
    expect(maskChannel({ type: "slack", url: "https://hooks.slack.com/services/T0/B0/abcdSECRETwxyz" })).toBe("hooks.slack.com/…/wxyz");
    expect(maskChannel({ type: "email", to: "anna@example.com" })).toBe("a…@example.com");
  });
});
