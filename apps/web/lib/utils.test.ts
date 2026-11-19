import { describe, expect, it } from "vitest";
import { daysBetween, flagEmoji, formatAge, formatCompact, formatPct } from "./utils";

describe("format helpers", () => {
  it("formats compact numbers", () => {
    expect(formatCompact(9_900_000)).toBe("9.9M");
    expect(formatCompact(null)).toBe("—");
  });
  it("formats signed percentages", () => {
    expect(formatPct(12.34)).toBe("+12%");
    expect(formatPct(-3.2, 1)).toBe("-3.2%");
    expect(formatPct(Infinity)).toBe("—");
  });
  it("formats store age in both languages", () => {
    const today = new Date("2026-11-18");
    expect(formatAge("2024-08-12", "en", today)).toBe("2 yr 3 mo");
    expect(formatAge("2024-11-01", "nl", today)).toBe("2 jr");
    expect(formatAge("2026-09-01", "nl", today)).toBe("2 mnd");
  });
  it("counts days", () => {
    expect(daysBetween("2026-11-01", "2026-11-18")).toBe(17);
  });
  it("builds flag emoji", () => {
    expect(flagEmoji("NL")).toBe("🇳🇱");
    expect(flagEmoji(null)).toBe("🏳️");
  });
});
