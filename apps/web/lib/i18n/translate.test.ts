import { describe, expect, it } from "vitest";
import { dictionaries } from "./dictionaries";
import { createTranslator } from "./translate";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`)));
}

describe("i18n", () => {
  it("interpolates and formats numbers per locale", () => {
    expect(createTranslator(dictionaries.nl, "nl")("explorer.results", { count: 2200000 })).toBe("2.200.000 resultaten");
    expect(createTranslator(dictionaries.en, "en")("explorer.results", { count: 2200000 })).toBe("2,200,000 results");
  });
  it("has the same keys in every language", () => {
    expect(keys(dictionaries.en).sort()).toEqual(keys(dictionaries.nl).sort());
  });
  it("falls back to the key when missing", () => {
    // @ts-expect-error onbekende sleutel
    expect(createTranslator(dictionaries.en, "en")("nope.missing")).toBe("nope.missing");
  });
});
