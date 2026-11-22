import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-tr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("emerging search terms, filters and keyword detail with forecast", async ({ page }) => {
  await login(page);
  await page.goto("/trends?phase=emerging");
  const table = page.getByTestId("trend-table");
  await expect(table).toBeVisible();
  await expect(table.locator("tbody tr").first()).toContainText("Opkomend");

  // Land wisselen herberekent groei en fase met dezelfde regels
  await page.goto("/trends?country=US&period=7");
  await expect(page.getByTestId("trend-table")).toBeVisible();

  await page.goto("/trends?q=cortisol");
  await page.getByRole("link", { name: "cortisol cocktail" }).click();
  await expect(page).toHaveURL(/\/trends\/\d+/);
  await expect(page.getByTestId("keyword-forecast")).toBeVisible();
  await expect(page.getByText("Nog geen product").or(page.getByText(/Zoekterm zonder product/))).toBeVisible();
  await expect(page.getByTestId("reddit-posts")).toBeVisible();
});

test("hashtags and seasonal calendar", async ({ page }) => {
  await login(page);
  await page.goto("/trends?tab=hashtags");
  await expect(page.getByTestId("trend-table").locator("tbody tr").first()).toContainText("#");
  await page.goto("/trends?tab=seasons");
  const calendar = page.getByTestId("season-calendar");
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("pool float");
});

test("product shows demand forecast and admin shows backtests", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/products");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByTestId("demand-forecast")).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByTestId("backtests")).toContainText("Spearman");
});
