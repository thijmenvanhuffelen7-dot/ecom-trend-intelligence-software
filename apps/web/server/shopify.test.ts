import { afterEach, describe, expect, it, vi } from "vitest";
import { createDraftProduct, normalizeShopDomain, ShopifyError, textToHtml, verifyShop } from "./shopify";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("shopify helpers", () => {
  it("normalizes shop domains", () => {
    expect(normalizeShopDomain("My-Store")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("https://my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("evil.com")).toBeNull();
    expect(normalizeShopDomain("my-store.myshopify.com.evil.com")).toBeNull();
  });
  it("escapes HTML in descriptions", () => {
    expect(textToHtml("Hallo <script>x</script>\n\nTweede & laatste")).toBe("<p>Hallo &lt;script&gt;x&lt;/script&gt;</p><p>Tweede &amp; laatste</p>");
  });
});

describe("shopify live calls", () => {
  it("creates a DRAFT product and sets the price on the default variant", async () => {
    vi.stubEnv("DATA_MODE", "live");
    const calls: { url: string; body: { query: string; variables: Record<string, unknown> }; token: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, body, token: (init.headers as Record<string, string>)["X-Shopify-Access-Token"]! });
      const data = body.query.includes("productCreate")
        ? { productCreate: { product: { id: "gid://shopify/Product/42", variants: { nodes: [{ id: "gid://shopify/ProductVariant/7" }] } }, userErrors: [] } }
        : { productVariantsBulkUpdate: { userErrors: [] } };
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const r = await createDraftProduct("my-store.myshopify.com", "shpat_abcdefghijklmnop1234", { title: "Mix", descriptionHtml: "<p>x</p>", price: 24.9, tags: ["trendscope"] });
    expect(r).toEqual({ id: "gid://shopify/Product/42", adminUrl: "https://admin.shopify.com/store/my-store/products/42" });
    expect(calls[0]!.url).toBe("https://my-store.myshopify.com/admin/api/2025-10/graphql.json");
    expect(calls[0]!.token).toBe("shpat_abcdefghijklmnop1234");
    expect((calls[0]!.body.variables.product as { status: string }).status).toBe("DRAFT");
    expect(calls[1]!.body.variables).toEqual({ productId: "gid://shopify/Product/42", variants: [{ id: "gid://shopify/ProductVariant/7", price: "24.90" }] });
  });
  it("maps auth and user errors", async () => {
    vi.stubEnv("DATA_MODE", "live");
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    await expect(verifyShop("x.myshopify.com", "shpat_abcdefghijklmnop1234")).rejects.toMatchObject({ code: "auth" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ data: { productCreate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } } })));
    await expect(createDraftProduct("x.myshopify.com", "t", { title: "", descriptionHtml: "", price: 1, tags: [] })).rejects.toBeInstanceOf(ShopifyError);
  });
  it("never calls Shopify in mock mode", async () => {
    vi.stubEnv("DATA_MODE", "mock");
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const r = await createDraftProduct("demo.myshopify.com", "shpat_abcdefghijklmnop1234", { title: "x", descriptionHtml: "", price: 1, tags: [] });
    expect(r.adminUrl).toMatch(/^https:\/\/admin\.shopify\.com\/store\/demo\/products\/\d+$/);
    expect(spy).not.toHaveBeenCalled();
  });
});
