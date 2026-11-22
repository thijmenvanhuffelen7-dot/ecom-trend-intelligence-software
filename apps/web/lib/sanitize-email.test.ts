import { describe, expect, it } from "vitest";
import { sanitizeEmailHtml } from "./sanitize-email";

describe("sanitizeEmailHtml", () => {
  it("removes scripts including their content, handlers and javascript: urls", () => {
    const out = sanitizeEmailHtml(
      `<p onclick="steal()">Hi</p><script>alert(document.cookie)</script><SCRIPT src=x></SCRIPT><a href=" javascript:alert(1)">x</a><iframe src="https://evil"></iframe><img src=x onerror=alert(1)>`,
      { images: true },
    );
    expect(out).not.toMatch(/alert|steal|<script|<iframe|onerror|onclick|javascript:/i);
    expect(out).toContain("<p>Hi</p>");
  });
  it("drops tracking pixels and blocks remote images until asked", () => {
    const html = `<img src="https://cdn.example/a.png" width="300"><img src="https://esp.example/open.gif" width="1" height="1">`;
    const blocked = sanitizeEmailHtml(html, { images: false });
    expect(blocked).not.toContain("open.gif");
    expect(blocked).toContain('data-blocked-src="https://cdn.example/a.png"');
    expect(blocked).not.toMatch(/\ssrc="https:/);
    expect(sanitizeEmailHtml(html, { images: true })).toContain('src="https://cdn.example/a.png"');
  });
  it("keeps forms and inputs out", () => {
    expect(sanitizeEmailHtml(`<form action="https://phish"><input name="pw"><button>Go</button></form>`, { images: true })).not.toMatch(/form|input|button/i);
  });
});
