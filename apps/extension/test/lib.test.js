import { describe, expect, it, vi } from "vitest";
import { badgeFor, formatEstimate, hostnameOf, isFresh, isValidKey, lookupStore, normalizeBase, originPattern } from "../src/lib.js";

describe("hostnameOf", () => {
  it.each([
    ["https://www.Example-Shop.nl/products/x?y=1", "example-shop.nl"],
    ["http://shop.brand.com/", "shop.brand.com"],
  ])("%s", (url, host) => expect(hostnameOf(url)).toBe(host));
  it.each(["chrome://extensions", "file:///etc/passwd", "http://localhost:3000", "http://192.168.1.10/", "about:blank", "not a url", "https://printer.local/"])("ignores %s", (url) =>
    expect(hostnameOf(url)).toBeNull(),
  );
});

describe("settings", () => {
  it("accepts https bases and localhost for development only", () => {
    expect(normalizeBase("https://app.trendscope.example/settings")).toBe("https://app.trendscope.example");
    expect(normalizeBase("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeBase("http://evil.example")).toBeNull();
    expect(normalizeBase("javascript:alert(1)")).toBeNull();
    expect(originPattern("https://app.trendscope.example")).toBe("https://app.trendscope.example/*");
  });
  it("validates key format", () => {
    expect(isValidKey("ts_live_" + "a".repeat(32))).toBe(true);
    expect(isValidKey("ts_live_short")).toBe(false);
  });
  it("cache freshness", () => {
    expect(isFresh({ at: 1000 }, 1000 + 60_000)).toBe(true);
    expect(isFresh({ at: 1000 }, 1000 + 11 * 60_000)).toBe(false);
    expect(isFresh(undefined)).toBe(false);
  });
});

describe("lookupStore", () => {
  const key = "ts_live_" + "a".repeat(32);
  it("sends the key and maps statuses", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { domain: "x.nl", top_products: [{ opportunity: 81.4 }] } }), { status: 200 }));
    const r = await lookupStore(fetchImpl, "https://app.example", key, "x.nl");
    expect(fetchImpl).toHaveBeenCalledWith("https://app.example/api/v1/stores/lookup?domain=x.nl", expect.objectContaining({ headers: { Authorization: `Bearer ${key}` } }));
    expect(r.status).toBe("ok");
    expect(badgeFor(r)).toEqual({ text: "81", color: "#1fb95a" });
    for (const [code, status] of [[404, "not_found"], [401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"], [500, "error"]]) {
      expect((await lookupStore(async () => new Response("{}", { status: code }), "https://a", key, "x.nl")).status).toBe(status);
    }
    expect((await lookupStore(async () => { throw new Error("offline"); }, "https://a", key, "x.nl")).status).toBe("error");
  });
  it("badge for known stores without scores and for unknown ones", () => {
    expect(badgeFor({ status: "ok", store: { top_products: [] } }).text).toBe("✓");
    expect(badgeFor({ status: "not_found" }).text).toBe("");
  });
});

describe("formatEstimate", () => {
  it("always marks estimates", () => {
    expect(formatEstimate({ value: 973168, low: 632559, high: 1411093 }, "en-US", "EUR")).toBe("≈ €632.6K–€1.4M");
    expect(formatEstimate({ value: 12000 }, "en-US")).toBe("≈ 12K");
    expect(formatEstimate(null)).toBe("—");
  });
});
