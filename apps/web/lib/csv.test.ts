import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("x\ny")).toBe('"x\ny"');
  });
  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-1+1")).toBe("'-1+1");
  });
  it("joins arrays and handles nulls", () => {
    expect(toCsv(["a", "b"], [[["x", "y"], null]])).toBe("a,b\r\nx; y,\r\n");
  });
});
