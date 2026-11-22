import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

afterEach(() => vi.unstubAllEnvs());

describe("authMode", () => {
  it("never allows the dev login in production", async () => {
    const { authMode } = await import("./server");
    vi.stubEnv("AUTH_MODE", "");
    vi.stubEnv("APP_ENV", "development");
    expect(authMode()).toBe("dev");
    vi.stubEnv("APP_ENV", "production");
    expect(() => authMode()).toThrow(/AUTH_MODE=clerk/);
    vi.stubEnv("AUTH_MODE", "clerk");
    expect(authMode()).toBe("clerk");
  });
});
