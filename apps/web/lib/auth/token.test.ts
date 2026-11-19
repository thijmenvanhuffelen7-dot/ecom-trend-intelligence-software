import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "./token";

const SECRET = "x".repeat(40);

describe("session tokens", () => {
  it("round-trips a valid token", async () => {
    const token = await signSession("a@b.nl", SECRET);
    expect((await verifySession(token, SECRET))?.email).toBe("a@b.nl");
  });
  it("rejects a tampered token", async () => {
    const token = await signSession("a@b.nl", SECRET);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ email: "admin@x.nl", iat: 0, exp: 9e9 })).toString("base64url");
    expect(await verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(await verifySession(`${body}.${sig}x`, SECRET)).toBeNull();
  });
  it("rejects a token signed with another secret", async () => {
    expect(await verifySession(await signSession("a@b.nl", "y".repeat(40)), SECRET)).toBeNull();
  });
  it("rejects an expired token", async () => {
    const token = await signSession("a@b.nl", SECRET, Date.now() - 31 * 86_400_000);
    expect(await verifySession(token, SECRET)).toBeNull();
  });
  it("refuses short secrets", async () => {
    await expect(signSession("a@b.nl", "short")).rejects.toThrow(/32/);
  });
});
