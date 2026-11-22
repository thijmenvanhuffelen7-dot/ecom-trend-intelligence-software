import { describe, expect, it } from "vitest";
import { normalizeDomain } from "./stores";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Example-Shop.nl/products/x?y=1", "example-shop.nl"],
    ["shop.example.com:443", "shop.example.com"],
    ["WWW.brand.store.", "brand.store"],
  ])("%s → %s", (input, out) => expect(normalizeDomain(input)).toBe(out));
  it.each(["", "localhost", "http://", "not a domain", "127.0.0.1", "a".repeat(300) + ".com"])("rejects %s", (input) => expect(normalizeDomain(input)).toBeNull());
});
