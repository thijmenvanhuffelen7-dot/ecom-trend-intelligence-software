import { describe, expect, it } from "vitest";
import { assertCan, assertWithinLimit, can, dataWindowStart, formatEstimateRange, keywordTrend, LimitExceededError, parseEstimate, unitEconomics } from "./index";

describe("plans", () => {
  it("blocks features not in the plan", () => {
    expect(() => assertWithinLimit("free", "alerts", 0)).toThrow(LimitExceededError);
  });
  it("allows usage within limits and blocks above", () => {
    expect(() => assertWithinLimit("starter", "tracked_shops", 4)).not.toThrow();
    expect(() => assertWithinLimit("starter", "tracked_shops", 5)).toThrow(/Limiet/);
  });
  it("treats Infinity as unlimited", () => {
    expect(() => assertWithinLimit("pro", "searches_per_day", 1e9)).not.toThrow();
  });
  it("computes the data window", () => {
    expect(dataWindowStart("free", new Date("2026-11-18T00:00:00Z")).toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });
});

describe("permissions", () => {
  it("only owners manage billing", () => {
    expect(can("owner", "billing.manage")).toBe(true);
    expect(can("admin", "billing.manage")).toBe(false);
    expect(() => assertCan("member", "members.invite")).toThrow();
  });
});

describe("estimates", () => {
  it("parses and formats a range", () => {
    const e = parseEstimate({ value: 20000, low: 13000, high: 29000, confidence: "medium", method: "x", currency: "EUR" });
    expect(e).not.toBeNull();
    expect(formatEstimateRange(e!, "en")).toBe("€13K – €29K");
  });
  it("shows a single number for exact values", () => {
    expect(formatEstimateRange({ value: 4800, low: 4800, high: 4800, confidence: "high", method: "x" }, "en")).toBe("4.8K");
  });
  it("rejects malformed estimates", () => {
    expect(parseEstimate({ value: "x" })).toBeNull();
  });
});

describe("unitEconomics", () => {
  it("computes margins and break-even ROAS", () => {
    const r = unitEconomics({ salePrice: 40, productCost: 8, shippingCost: 4, feePct: 0.05, cpa: 12 });
    expect(r.grossProfit).toBeCloseTo(26);
    expect(r.netProfit).toBeCloseTo(14);
    expect(r.breakEvenRoas).toBeCloseTo(40 / 26);
  });

  it("takes VAT off revenue and charges returns", () => {
    const r = unitEconomics({ salePrice: 36.3, productCost: 8, shippingCost: 4, feePct: 0, vatPct: 0.21, returnRate: 0.1 });
    expect(r.vat).toBeCloseTo(6.3);
    expect(r.revenue).toBeCloseTo(30);
    expect(r.returns).toBeCloseTo(3);
    expect(r.grossProfit).toBeCloseTo(15);
    expect(r.netMargin).toBeCloseTo(0.5);
  });
});

describe("keywordTrend (gelijk aan de Python-worker)", () => {
  const series = (n: number, f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  it.each([
    [(i: number) => (i < 680 ? 2 : 2 + (i - 680) ** 1.5), "emerging"],
    [(i: number) => 10 * Math.exp(i / 150), "rising"],
    [(i: number) => 100 - Math.max(0, i - 650) * 0.9, "declining"],
    [() => 50, "peak"],
  ] as const)("fase %#", (f, phase) => {
    expect(keywordTrend(series(730, f)).phase).toBe(phase);
  });
});
