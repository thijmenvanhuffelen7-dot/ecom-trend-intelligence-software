import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

describe("assistant markdown", () => {
  it("renders internal and https links, never javascript: or raw html", () => {
    const html = renderToStaticMarkup(
      <Markdown text={"See [Mug](/explorer/products/6) and [docs](https://example.com).\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>"} />,
    );
    expect(html).toContain('href="/explorer/products/6"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
  it("keeps snake_case identifiers intact", () => {
    const html = renderToStaticMarkup(<Markdown text={"Zet ANTHROPIC_API_KEY of `MY_KEY`, en _dit_ is cursief."} />);
    expect(html).toContain("ANTHROPIC_API_KEY");
    expect(html).toContain("<em");
  });
  it("renders lists, bold and tables", () => {
    const html = renderToStaticMarkup(<Markdown text={"- **a** one\n- b\n\n| h1 | h2 |\n|---|---|\n| 1 | 2 |"} />);
    expect(html).toContain("<ul");
    expect(html).toContain("<strong>a</strong>");
    expect(html).toContain("<table");
    expect(html).not.toContain("---");
  });
});
