import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-al-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("channel + rule → check now → alerts in feed and bell", async ({ page }) => {
  await login(page);
  await page.goto("/alerts");

  // Kanaal: ongeldige Slack-URL wordt geweigerd, een echte wordt gemaskeerd opgeslagen
  const cf = page.getByTestId("channel-form");
  await cf.locator('input[name="url"]').fill("https://evil.example/services/x");
  await cf.getByRole("button").click();
  await expect(cf.getByRole("status")).toContainText("Controleer");
  await cf.locator('input[name="url"]').fill("https://hooks.slack.com/services/T000/B000/abcdSECRETwxyz");
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/alerts"));
  await cf.getByRole("button").click();
  await saved;
  await expect(page.getByTestId("channel-list")).toContainText("hooks.slack.com/…/wxyz");
  await expect(page.getByTestId("channel-list")).not.toContainText("SECRET");

  // Regel: validatie > 50 over alles
  const rb = page.getByTestId("rule-builder");
  await rb.locator('input[name="value"]').fill("50");
  await rb.locator('select[name="scope"]').selectOption("all");
  await rb.locator('input[name="name"]').fill("Sterke producten");
  const created = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/alerts"));
  await rb.getByRole("button", { name: /Regel opslaan/ }).click();
  await created;
  await expect(page.getByTestId("rule-list")).toContainText("Sterke producten");

  await page.getByTestId("evaluate-now").click();
  await expect(page.getByRole("status").filter({ hasText: /nieuwe meldingen/ })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("alert-feed").locator("li").first()).toContainText("validatie");
  await expect(page.getByTestId("nav-alerts")).toContainText(/\d/);
});
