/** OpenAPI 3.1-beschrijving van de publieke API v1 (bron voor /api/v1/openapi.json en de pagina /developers). */
import { API_SCOPES } from "./keys";
import { API_RATE_PER_MINUTE } from "./auth";

const estimate = (desc: string) => ({
  type: ["object", "null"],
  description: `${desc} Always an estimate.`,
  properties: { value: { type: "number" }, low: { type: "number" }, high: { type: "number" }, growth_pct: { type: ["number", "null"] }, confidence: { type: "string" }, is_estimate: { const: true } },
});

const q = (name: string, description: string, schema: object = { type: "string" }) => ({ name, in: "query", required: false, description, schema });
const page = q("page", "1-based page number.", { type: "integer", minimum: 1, default: 1 });
const errors = {
  "401": { $ref: "#/components/responses/Error", description: "Missing, malformed or revoked key." },
  "403": { $ref: "#/components/responses/Error", description: "Missing scope, or API not included in the plan." },
  "429": { $ref: "#/components/responses/Error", description: "Rate limit or monthly quota exceeded (see Retry-After)." },
};
const ok = (schema: object, description = "OK") => ({ "200": { description, content: { "application/json": { schema } } }, ...errors });
const list = (item: string, extra: object = {}) => ({ type: "object", properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } }, total: { type: "integer" }, ...extra } });

export function openApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Trendscope API",
      version: "1.0.0",
      description: [
        "Read-only access to Trendscope's product, store and trend intelligence.",
        "",
        `Authenticate with \`Authorization: Bearer ts_live_…\` (create keys under Settings → API). Limits: ${API_RATE_PER_MINUTE} requests/minute per key, plus the monthly quota of your plan.`,
        "Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` and `X-Quota-Remaining`.",
        "Revenue, visits and sales figures are estimates and are marked `is_estimate: true`. Scores are `null` until a product has 7 days of data.",
      ].join("\n"),
    },
    servers: [{ url: `${serverUrl.replace(/\/$/, "")}/api/v1` }],
    security: [{ bearer: [] }],
    paths: {
      "/me": { get: { summary: "Verify a key", operationId: "getMe", responses: ok({ type: "object" }) } },
      "/products": {
        get: {
          summary: "Search products",
          operationId: "listProducts",
          description: "Same filters as the product explorer. Requires `read:products`.",
          parameters: [
            q("q", "Title contains."), q("niche", "Niche slug(s), comma separated."), q("phase", "emerging, rising, peak, saturated, declining (comma separated)."),
            q("minval", "Minimum validation score (0–100).", { type: "number" }), q("maxsat", "Maximum saturation in % (0–100).", { type: "number" }),
            q("price", "Price range `min-max`, e.g. 10-40."), q("source", "shops, marketplaces, both."),
            q("sort", "opportunity, validation, growth, saturation_asc, stores, marketplace_orders, newest."), page,
          ],
          responses: ok(list("ProductSummary", { page: { type: "integer" }, page_size: { type: "integer" } })),
        },
      },
      "/products/{id}": {
        get: {
          summary: "Product detail with score explanation",
          operationId: "getProduct",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { ...ok({ type: "object", properties: { data: { $ref: "#/components/schemas/ProductDetail" } } }), "404": { $ref: "#/components/responses/Error" } },
        },
      },
      "/stores": {
        get: {
          summary: "Search stores",
          operationId: "listStores",
          description: "Same filters as the Shop Explorer. Requires `read:stores`.",
          parameters: [
            q("q", "Name or domain contains."), q("niche", "Niche slug(s)."), q("origin", "Store country (ISO-2), comma separated."), q("vc", "Visitor countries (ISO-2)."),
            q("traffic", "Monthly visits range `min-max`."), q("platform", "shopify, woocommerce, other."), q("apps", "Installed apps, comma separated."), q("ads", "Live ads range `min-max`."),
            q("sort", "relevance, visits, visits_growth, live_ads, ads_growth, recent_changes, newest, products."), page,
          ],
          responses: ok(list("StoreSummary", { page: { type: "integer" }, page_size: { type: "integer" } })),
        },
      },
      "/stores/{id}": {
        get: { summary: "Store detail", operationId: "getStore", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { ...ok({ type: "object", properties: { data: { $ref: "#/components/schemas/StoreDetail" } } }), "404": { $ref: "#/components/responses/Error" } } },
      },
      "/stores/lookup": {
        get: {
          summary: "Look up a store by domain",
          operationId: "lookupStore",
          parameters: [{ name: "domain", in: "query", required: true, schema: { type: "string" }, example: "example-shop.com" }],
          responses: { ...ok({ type: "object", properties: { data: { $ref: "#/components/schemas/StoreDetail" } } }), "404": { $ref: "#/components/responses/Error", description: "Not tracked (yet)." } },
        },
      },
      "/trends": {
        get: {
          summary: "Search-term and hashtag trends",
          operationId: "listTrends",
          parameters: [q("kind", "keyword (default) or hashtag."), q("country", "NL, BE, DE, FR, GB, US …"), q("period", "Growth window in days: 7, 30, 90."), q("phase", "Phase filter."), q("niche", "Niche slug(s)."), q("sort", "growth, interest, newest."), q("limit", "Max rows (≤ 200).", { type: "integer", default: 50 })],
          responses: ok(list("Trend", { country: { type: "string" }, period_days: { type: "integer" } })),
        },
      },
      "/leads": {
        get: {
          summary: "B2B store leads (business data only)",
          operationId: "listLeads",
          description: "Public company information about web stores. No personal data. Each returned row counts towards the monthly `leads_export` quota. Requires `read:leads`.",
          parameters: [q("niche", "Niche slug(s)."), q("country", "Store country (ISO-2)."), q("platform", "shopify, woocommerce, other."), q("min_visits", "Minimum estimated monthly visits.", { type: "integer" }), q("has_ads", "1 = only stores with live ads."), q("esp", "Email provider, e.g. klaviyo."), q("app", "Installed app."), q("limit", "≤ 1000.", { type: "integer", default: 100 }), q("offset", "Offset.", { type: "integer", default: 0 })],
          responses: ok(list("Lead", { offset: { type: "integer" }, truncated: { type: "boolean", description: "True when the quota cut the page short." } })),
        },
      },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: `API key. Scopes: ${API_SCOPES.join(", ")}.` } },
      responses: {
        Error: { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } } } } } } },
      },
      schemas: {
        Scores: {
          type: ["object", "null"],
          description: "Null until there are 7 days of data.",
          properties: { opportunity: { type: "number" }, validation: { type: "number" }, saturation: { type: "number", minimum: 0, maximum: 1 }, growth_velocity: { type: "number" }, phase: { type: "string", enum: ["emerging", "rising", "peak", "saturated", "declining"] } },
        },
        ProductSummary: {
          type: "object",
          properties: {
            id: { type: "integer" }, title: { type: "string" }, image_url: { type: ["string", "null"] }, niche: { type: ["string", "null"] },
            price: { type: "object", properties: { min: { type: ["number", "null"] }, max: { type: ["number", "null"] }, currency: { type: "string" } } },
            scores: { $ref: "#/components/schemas/Scores" }, store_count: { type: "integer" }, ad_count: { type: "integer" }, creator_count: { type: "integer" },
            marketplace_orders_30d: estimate("Marketplace orders in the last 30 days."), curated: { type: "boolean" }, first_seen: { type: "string", format: "date-time" }, url: { type: "string" },
          },
        },
        ProductDetail: {
          allOf: [{ $ref: "#/components/schemas/ProductSummary" }],
          properties: { explanation: { type: ["object", "null"], description: "Per-signal contribution to the score." }, keywords: { type: "array" }, stores: { type: "array" }, ads: { type: "array" }, suppliers: { type: "array" }, forecast: { type: ["object", "null"] } },
        },
        StoreSummary: {
          type: "object",
          properties: { id: { type: "integer" }, name: { type: ["string", "null"] }, domain: { type: "string" }, country: { type: ["string", "null"] }, platform: { type: "string" }, niches: { type: "array", items: { type: "string" } }, launched_at: { type: ["string", "null"] }, product_count: { type: "integer" }, products_added_7d: { type: "integer" }, live_ads: { type: "integer" }, monthly_visits: estimate("Monthly visits."), url: { type: "string" } },
        },
        StoreDetail: {
          allOf: [{ $ref: "#/components/schemas/StoreSummary" }],
          properties: { monthly_revenue: estimate("Monthly revenue in EUR."), technologies: { type: "array", items: { type: "object", properties: { type: { type: "string" }, name: { type: "string" } } } }, email_marketing: { type: ["object", "null"] }, top_products: { type: "array" } },
        },
        Trend: {
          type: "object",
          properties: { id: { type: "integer" }, term: { type: "string" }, kind: { type: "string" }, phase: { type: ["string", "null"] }, interest: { type: ["number", "null"], description: "Relative interest 0–100, not absolute volume." }, growth_pct: { type: "number" }, growth_7d_pct: { type: ["number", "null"] }, forecast_30d_pct: { type: ["number", "null"] }, product: { type: ["object", "null"] }, series: { type: "array", items: { type: "number" } } },
        },
        Lead: {
          type: "object",
          properties: {
            ...Object.fromEntries(["domain", "name", "country", "platform", "niche", "launched_at", "email_provider", "theme", "instagram", "tiktok", "facebook", "trendscope_url"].map((k) => [k, { type: ["string", "null"] }])),
            ...Object.fromEntries(["product_count", "live_ads", "monthly_visits_est", "revenue_est_low", "revenue_est_high", "trustpilot_score"].map((k) => [k, { type: ["number", "null"] }])),
            apps: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
  };
}
