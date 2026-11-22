import { describe, expect, it } from "vitest";
import { flagBucket, flagEnabledFor } from "./flags";

const ws = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, plan: "pro" as const });

describe("feature flags", () => {
  it("off when disabled or unknown", () => {
    expect(flagEnabledFor(undefined, ws(1))).toBe(false);
    expect(flagEnabledFor({ key: "x", enabled: false, rollout: {} }, ws(1))).toBe(false);
  });
  it("percentage rollout is stable and roughly proportional", () => {
    const flag = { key: "public_api", enabled: true, rollout: { percent: 30 } };
    const on = Array.from({ length: 1000 }, (_, i) => flagEnabledFor(flag, ws(i))).filter(Boolean).length;
    expect(on).toBeGreaterThan(220);
    expect(on).toBeLessThan(380);
    expect(flagBucket("public_api", ws(7).id)).toBe(flagBucket("public_api", ws(7).id));
  });
  it("plans restrict, explicit workspaces always win", () => {
    const flag = { key: "x", enabled: true, rollout: { percent: 100, plans: ["business"], workspaces: [ws(3).id] } };
    expect(flagEnabledFor(flag, ws(2))).toBe(false);
    expect(flagEnabledFor(flag, ws(3))).toBe(true);
    expect(flagEnabledFor(flag, { ...ws(2), plan: "business" })).toBe(true);
  });
});
