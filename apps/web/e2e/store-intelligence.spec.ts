import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-si-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("shop detail shows the crawl timeline with filters", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops?sort=recent_changes");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Tijdlijn" })).toBeVisible();
  await expect(page.getByText("Crawlstatus")).toBeVisible();
  // filteren op prijswijzigingen laat alleen prijs-events zien
  await page.getByRole("button", { name: /^Prijs \d+/ }).click();
  await expect(page.getByText("Prijswijziging").first()).toBeVisible();
  await expect(page.getByText("Nieuw product")).toHaveCount(0);
});

test("new launches view lists stores discovered by the crawler", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops");
  await page.getByRole("button", { name: "Nieuwe lanceringen" }).click();
  await expect(page).toHaveURL(/view=new-launches/);
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await expect(page.locator("tbody")).toContainText(/nieuw \(7d\)/);
});

test("platform filter narrows to WooCommerce stores", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops?platform=woocommerce");
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
});

test("admin shows freshness per data source and discovery candidates", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  await expect(page.getByText("Versheid per databron")).toBeVisible();
  await expect(page.getByText("shopify_storefront")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Discovery-kandidaten" })).toBeVisible();
});

test("command palette finds shops and products (⌘K)", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Zoek winkels en producten…").fill("posture");
  await expect(page.getByRole("dialog").getByText("Posture Corrector Pro")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/explorer\/products\/\d+/);
});

test("admins can queue an immediate crawl", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await page.getByRole("button", { name: "Nu crawlen" }).click();
  await expect(page.getByRole("button", { name: "In de wachtrij" })).toBeVisible();
});
