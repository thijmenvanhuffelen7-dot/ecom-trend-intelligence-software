import { describe, expect, it } from "vitest";
import { generateKey, hashesEqual, hashKey, parseKey } from "./keys";

describe("api keys", () => {
  it("generates parseable keys whose hash matches", () => {
    const { key, prefix, hash } = generateKey();
    expect(key).toMatch(/^ts_live_[0-9A-Za-z]{32}$/);
    const parsed = parseKey(`Bearer ${key}`);
    expect(parsed).toEqual({ key, prefix });
    expect(hashesEqual(hashKey(parsed!.key), hash)).toBe(true);
  });
  it("rejects malformed headers", () => {
    expect(parseKey(null)).toBeNull();
    expect(parseKey("Bearer ts_live_short")).toBeNull();
    expect(parseKey("Basic abc")).toBeNull();
    expect(parseKey(`Bearer ${generateKey().key} extra`)).toBeNull();
  });
  it("keys are unique", () => {
    expect(new Set(Array.from({ length: 50 }, () => generateKey().key)).size).toBe(50);
  });
});
