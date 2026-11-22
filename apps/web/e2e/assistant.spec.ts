import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("assistant answers with tool results and links, and keeps the conversation", async ({ page }) => {
  await login(page);
  await page.goto("/assistant");
  await page.getByRole("button", { name: /keukenproducten/ }).click();
  const answer = page.getByTestId("assistant-message").last();
  await expect(answer).toContainText("Producten gezocht");
  await expect(answer.locator('a[href^="/explorer/products/"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/assistant\?c=/);
  await page.reload();
  await expect(page.getByTestId("conversation-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("assistant-message").first().locator('a[href^="/explorer/products/"]').first()).toBeVisible();
});

test("AI report and ad copy on a product page", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/products");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  const report = page.getByTestId("ai-report");
  // Rapporten zijn gedeeld per product; bestaat er al een, dan vernieuwen we het
  await report.getByRole("button", { name: /Genereer rapport|Opnieuw/ }).first().click();
  await expect(report).toContainText("Oordeel", { timeout: 30_000 });
  await expect(report).toContainText("Prijsstrategie");
  const copy = page.getByTestId("ai-copy");
  await copy.getByRole("button", { name: /Genereer teksten|Opnieuw/ }).first().click();
  await expect(copy).toContainText("Hooks", { timeout: 30_000 });
});

test("ad detail shows creative analysis", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/ads?platform=meta&view=scaling");
  await page.locator("article a[aria-label]").first().click();
  await expect(page.getByTestId("creative-analysis")).toContainText("Hook");
});
