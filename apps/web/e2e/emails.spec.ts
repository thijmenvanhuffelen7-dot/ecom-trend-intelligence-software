import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-em-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("email archive, sandboxed viewer and store funnel", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/emails?type=promotion&sort=discount");
  const list = page.getByTestId("email-list");
  await expect(list.locator("li").first()).toContainText("%");
  await list.locator("li a").first().click();
  await expect(page).toHaveURL(/\/explorer\/emails\/\d+/);
  const frame = page.getByTestId("email-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
  await expect(frame).not.toHaveAttribute("sandbox", /allow-scripts|allow-same-origin/);
  // via de winkel naar de funnel
  await page.getByRole("link", { name: "Shop" }).or(page.locator("dd a").first()).first().click();
  await expect(page.getByTestId("shop-funnel")).toBeVisible();
  await expect(page.getByTestId("shop-emails")).toContainText(/Actief|Ingeschreven/);
});
