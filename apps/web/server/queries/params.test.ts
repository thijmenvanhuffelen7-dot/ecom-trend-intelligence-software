import { describe, expect, it } from "vitest";
import { list, num, oneOf, page, range } from "./params";

describe("search param parsing", () => {
  it("parses lists and filters unknown values", () => {
    expect(list({ c: "NL,DE,,XX" }, "c", ["NL", "DE"])).toEqual(["NL", "DE"]);
  });
  it("parses ranges with open ends", () => {
    expect(range({ t: "1000-" }, "t")).toEqual({ min: 1000, max: undefined });
    expect(range({ t: "-50" }, "t")).toEqual({ min: undefined, max: 50 });
    expect(range({ t: "abc-def" }, "t")).toEqual({ min: undefined, max: undefined });
  });
  it("rejects garbage numbers and clamps pages", () => {
    expect(num({ n: "1e3" }, "n")).toBe(1000);
    expect(num({ n: "drop table" }, "n")).toBeUndefined();
    expect(page({ page: "-4" })).toBe(1);
    expect(page({ page: "99999999" })).toBe(10000);
  });
  it("falls back for unknown enum values", () => {
    expect(oneOf({ s: "evil" }, "s", ["a", "b"] as const, "a")).toBe("a");
  });
});
