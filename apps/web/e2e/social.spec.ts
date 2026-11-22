import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-so-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("TikTok Shop rankings and creator discovery", async ({ page }) => {
  await login(page);
  await page.goto("/social");
  await expect(page.getByTestId("social-table").locator("tbody tr").first()).toBeVisible();
  await page.goto("/social?tab=shops");
  await expect(page.getByTestId("social-table")).toContainText(/€|\$/);
  await page.goto("/social?tab=creators&contact=1");
  const first = page.getByTestId("social-table").locator("tbody tr").first();
  await expect(first).toBeVisible();
  await first.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/social\/creators\/\d+/);
  await expect(page.getByRole("link", { name: /@.*\.example|collab@/ })).toBeVisible();
  await expect(page.getByTestId("creator-videos")).toBeVisible();
});

test("videos and livestreams", async ({ page }) => {
  await login(page);
  await page.goto("/social?tab=videos");
  await expect(page.getByTestId("social-videos").locator("article").first()).toBeVisible();
  await page.goto("/social?tab=lives");
  await expect(page.getByTestId("social-table").locator("tbody tr").first()).toBeVisible();
});
