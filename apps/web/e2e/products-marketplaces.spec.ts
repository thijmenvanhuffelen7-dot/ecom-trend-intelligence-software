import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-mp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("marketplace filter and product detail with matched listings and supplier finder", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/products?source=marketplaces&sort=marketplace_orders");
  const first = page.locator("tbody tr").first().getByRole("link").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/explorer\/products\/\d+/);

  const listings = page.getByTestId("marketplace-listings");
  await expect(listings).toBeVisible();
  await expect(listings).toContainText(/AliExpress|Amazon|CJ/i);
  await expect(listings.getByText(/tekst \d+%/).first()).toBeVisible();

  // Een andere leverancier kiezen zet zijn inkoopprijs in de calculator
  const suppliers = page.getByTestId("supplier-list").getByRole("button");
  await expect(suppliers.first()).toHaveAttribute("aria-pressed", "true");
  const count = await suppliers.count();
  if (count > 1) {
    await suppliers.nth(count - 1).click();
    await expect(suppliers.nth(count - 1)).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.getByText("Nettowinst per order")).toBeVisible();
  await expect(page.getByLabel("BTW")).toHaveValue("21");
});

test("self-discovered marketplace product: listings plus an explained score (or 'pending')", async ({ page }) => {
  await login(page);
  // "Electric Scalp Massager" bestaat alleen op marktplaatsen; de clustering maakte er zelf een product van
  await page.goto("/explorer/products?source=marketplaces&q=Electric%20Scalp");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByTestId("marketplace-listings")).toBeVisible();
  // Na 7 dagen data volgt een echte, uitgelegde score; daarvoor "Score volgt" — nooit een verzonnen getal
  await expect(page.getByTestId("score-pending").or(page.getByText("Waarom deze score?"))).toBeVisible();
});

test("admin shows clustering health", async ({ page }) => {
  await login(page);
  await page.goto("/admin");
  const card = page.getByTestId("clustering-stats");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Zelf ontdekt");
});
