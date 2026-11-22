import "server-only";
import { randomInt } from "node:crypto";

/**
 * Shopify Admin GraphQL API (custom app in de eigen winkel van de gebruiker, token `shpat_…`).
 * We maken alleen concepten (status DRAFT): niets komt live zonder dat de gebruiker het in Shopify publiceert.
 * In DATA_MODE=mock (standaard lokaal) praten we niet met Shopify maar simuleren we de antwoorden.
 */
export const SHOPIFY_API_VERSION = "2025-10";
export const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
export const TOKEN_RE = /^shp(at|ca|pa)_[A-Za-z0-9]{16,64}$/;

export const shopifyMode = (): "live" | "mock" => (process.env.DATA_MODE === "live" ? "live" : "mock");

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly code: "auth" | "scope" | "rate" | "user" | "network",
  ) {
    super(message);
  }
}

export function normalizeShopDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const full = host.includes(".") ? host : `${host}.myshopify.com`;
  return SHOP_DOMAIN_RE.test(full) ? full : null;
}

async function gql<T>(domain: string, token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    throw new ShopifyError("Shopify is niet bereikbaar.", "network");
  }
  if (res.status === 401) throw new ShopifyError("Ongeldig of ingetrokken access token.", "auth");
  if (res.status === 403) throw new ShopifyError("Het token mist de scope write_products.", "scope");
  if (res.status === 429) throw new ShopifyError("Shopify-limiet bereikt; probeer het zo opnieuw.", "rate");
  if (!res.ok) throw new ShopifyError(`Shopify antwoordde met ${res.status}.`, "network");
  const body = (await res.json()) as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] };
  if (body.errors?.length) {
    const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
    throw new ShopifyError(throttled ? "Shopify-limiet bereikt; probeer het zo opnieuw." : body.errors[0]!.message, throttled ? "rate" : "user");
  }
  return body.data as T;
}

export async function verifyShop(domain: string, token: string): Promise<{ name: string }> {
  if (shopifyMode() === "mock") return { name: `${domain.split(".")[0]} (demo)` };
  const data = await gql<{ shop: { name: string } }>(domain, token, "{ shop { name } }");
  return { name: data.shop.name };
}

export interface DraftProduct {
  title: string;
  descriptionHtml: string;
  price: number;
  productType?: string | null;
  tags: string[];
}

export async function createDraftProduct(domain: string, token: string, p: DraftProduct): Promise<{ id: string; adminUrl: string }> {
  const store = domain.replace(".myshopify.com", "");
  if (shopifyMode() === "mock") {
    const id = String(9_000_000_000 + randomInt(1, 999_999_999));
    return { id: `gid://shopify/Product/${id}`, adminUrl: `https://admin.shopify.com/store/${store}/products/${id}` };
  }
  const created = await gql<{ productCreate: { product: { id: string; variants: { nodes: { id: string }[] } } | null; userErrors: { field: string[]; message: string }[] } }>(
    domain,
    token,
    `mutation create($product: ProductCreateInput!) {
       productCreate(product: $product) {
         product { id variants(first: 1) { nodes { id } } }
         userErrors { field message }
       }
     }`,
    { product: { title: p.title, descriptionHtml: p.descriptionHtml, productType: p.productType ?? undefined, tags: p.tags, status: "DRAFT" } },
  );
  const r = created.productCreate;
  if (r.userErrors.length || !r.product) throw new ShopifyError(r.userErrors[0]?.message ?? "Product aanmaken mislukt.", "user");
  // Nieuwe productmodellen maken één standaardvariant; de prijs zetten we daarop
  const variant = r.product.variants.nodes[0];
  if (variant) {
    const upd = await gql<{ productVariantsBulkUpdate: { userErrors: { message: string }[] } }>(
      domain,
      token,
      `mutation price($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
         productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { message } }
       }`,
      { productId: r.product.id, variants: [{ id: variant.id, price: p.price.toFixed(2) }] },
    );
    if (upd.productVariantsBulkUpdate.userErrors.length) throw new ShopifyError(upd.productVariantsBulkUpdate.userErrors[0]!.message, "user");
  }
  const numeric = r.product.id.split("/").pop();
  return { id: r.product.id, adminUrl: `https://admin.shopify.com/store/${store}/products/${numeric}` };
}

/** Eenvoudige, veilige HTML uit platte tekst (alinea's), zonder door de gebruiker of AI aangeleverde tags. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
