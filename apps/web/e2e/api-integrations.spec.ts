import path from "node:path";
import { chromium, expect, test, type Page } from "@playwright/test";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function login(page: Page) {
  const email = `e2e-api-${uniq()}@trendscope.dev`;
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
  return email;
}

async function setPlan(page: Page, email: string, plan: string) {
  await page.goto(`/admin?tab=users&q=${encodeURIComponent(email)}`);
  const row = page.getByTestId("admin-users").locator("tbody tr").filter({ hasText: email });
  await row.getByLabel("Plan").selectOption(plan);
  await expect(row.getByLabel("Opgeslagen")).toBeVisible();
}

async function createKey(page: Page, name: string) {
  await page.goto("/settings/api");
  const form = page.getByTestId("create-key");
  await form.getByLabel(/Naam/).fill(name);
  await form.getByRole("button", { name: "Sleutel maken" }).click();
  return (await page.getByTestId("new-key").textContent())!.trim();
}

test("public API: keys, scopes, data, rate-limit headers and OpenAPI", async ({ page, request }) => {
  const email = await login(page);
  // Pro (trial) heeft geen API: alleen een extensiesleutel kan
  await page.goto("/settings/api");
  await expect(page.getByTestId("api-locked")).toBeVisible();

  await setPlan(page, email, "business");
  const key = await createKey(page, `e2e ${uniq()}`);
  expect(key).toMatch(/^ts_live_[0-9A-Za-z]{32}$/);
  const auth = { Authorization: `Bearer ${key}` };

  const products = await request.get("/api/v1/products?sort=opportunity", { headers: auth });
  expect(products.status()).toBe(200);
  expect(products.headers()["x-ratelimit-limit"]).toBe("120");
  expect(Number(products.headers()["x-quota-remaining"])).toBeGreaterThan(0);
  const pb = await products.json();
  expect(pb.data.length).toBeGreaterThan(0);
  expect(pb.data[0]).toMatchObject({ id: expect.any(Number), title: expect.any(String), url: expect.stringContaining("/explorer/products/") });

  const detail = await (await request.get(`/api/v1/products/${pb.data[0].id}`, { headers: auth })).json();
  expect(detail.data.id).toBe(pb.data[0].id);

  const stores = await (await request.get("/api/v1/stores?sort=visits", { headers: auth })).json();
  const store = stores.data[0];
  expect(store.monthly_visits?.is_estimate ?? true).toBe(true);
  const lookup = await request.get(`/api/v1/stores/lookup?domain=${encodeURIComponent(`https://www.${store.domain}/collections/all`)}`, { headers: auth });
  expect(lookup.status()).toBe(200);
  expect((await lookup.json()).data.domain).toBe(store.domain);
  expect((await request.get("/api/v1/stores/lookup?domain=unknown-shop-xyz.example", { headers: auth })).status()).toBe(404);

  const trends = await (await request.get("/api/v1/trends?kind=keyword&limit=5", { headers: auth })).json();
  expect(trends.data.length).toBeLessThanOrEqual(5);

  // Standaard heeft een sleutel geen read:leads
  const leads = await request.get("/api/v1/leads", { headers: auth });
  expect(leads.status()).toBe(403);
  expect((await leads.json()).error.code).toBe("insufficient_scope");

  expect((await request.get("/api/v1/products", { headers: { Authorization: "Bearer ts_live_" + "x".repeat(32) } })).status()).toBe(401);
  expect((await request.get("/api/v1/products")).status()).toBe(401);

  const spec = await request.get("/api/v1/openapi.json");
  expect(spec.status()).toBe(200);
  expect((await spec.json()).paths["/stores/lookup"]).toBeTruthy();
  await page.goto("/developers");
  await expect(page.getByTestId("api-docs")).toContainText("/stores/lookup");

  // Intrekken werkt direct
  await page.goto("/settings/api");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("api-keys").locator("li").first().getByRole("button", { name: "Intrekken" }).click();
  await expect(page.getByTestId("api-keys").locator("li").first()).toContainText("Ingetrokken");
  expect((await request.get("/api/v1/products", { headers: auth })).status()).toBe(401);
});

test("extension key works on Pro for store lookup only", async ({ page, request }) => {
  await login(page); // Pro-trial
  const key = await createKey(page, "Chrome");
  const auth = { Authorization: `Bearer ${key}` };
  const me = await request.get("/api/v1/me", { headers: auth });
  expect(me.status()).toBe(200);
  expect((await me.json()).data.key.scopes).toEqual(["extension"]);
  const stores = await (await request.get("/api/v1/stores", { headers: auth })).json();
  expect(stores.error.code).toBe("insufficient_scope");
  const anyStore = await page.request.get("/api/search?q=a");
  const domain = ((await anyStore.json()).shops?.[0]?.domain as string) ?? "";
  if (domain) expect((await request.get(`/api/v1/stores/lookup?domain=${domain}`, { headers: auth })).status()).toBe(200);
});

test("push a product to a (demo) Shopify store as draft", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const form = page.getByTestId("connect-shopify");
  await form.getByLabel("Shopify-domein").fill(`e2e-${uniq()}`);
  await form.getByLabel("Admin API access token").fill("shpat_" + "a".repeat(32));
  await form.getByRole("button", { name: "Koppelen" }).click();
  await expect(page.getByTestId("integrations")).toContainText("Demo-koppeling");

  await page.goto("/explorer/products?sort=opportunity");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  const card = page.getByTestId("push-card");
  await expect(card).toBeVisible();
  await card.getByLabel("Prijs").fill("24,95");
  await card.getByRole("button", { name: "Als concept naar Shopify" }).click();
  await expect(card.getByRole("status")).toContainText("Concept aangemaakt");
  await expect(card.getByRole("link", { name: "Openen in Shopify" })).toHaveAttribute("href", /admin\.shopify\.com\/store\/e2e-/);
  await page.reload();
  await expect(page.getByTestId("push-history")).toContainText("Aangemaakt");
});

test("B2B leads CSV on Business, business fields only", async ({ page }) => {
  const email = await login(page);
  await setPlan(page, email, "business");
  await page.goto("/explorer/shops");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("leads-export").click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  const [header, first] = csv.split("\r\n");
  expect(header).toBe("domain,name,country,platform,niche,launched_at,product_count,live_ads,monthly_visits_est,revenue_est_low,revenue_est_high,email_provider,theme,apps,instagram,tiktok,facebook,trustpilot_score,trendscope_url");
  expect(first).toMatch(/\.[a-z]{2,}/);
  expect(csv).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i); // geen e-mailadressen
});

test("browser extension loads (MV3 service worker, popup and options)", async () => {
  const dir = path.resolve(process.cwd(), "../extension"); // tests draaien vanuit apps/web
  const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const id = sw.url().split("/")[2];
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/src/popup.html`);
    await expect(page.locator("#root")).toContainText("Open een webshop");
    await page.goto(`chrome-extension://${id}/src/options.html`);
    await expect(page.locator("#base")).toHaveValue("https://app.trendscope.example");
    // Zonder sleutel en toestemming vraagt de extensie niets op (alleen opslag, geen host-toegang)
    expect(await sw.evaluate(() => chrome.permissions.getAll())).toMatchObject({ origins: [] });
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});
