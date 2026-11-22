import { expect, test, type Page } from "@playwright/test";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function login(page: Page, email = `e2e-launch-${uniq()}@example.com`) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
  return email;
}

test("public landing page, legal pages and security headers", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const res = await page.goto("/");
  expect(res?.status()).toBe(200);
  const h = res!.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("winnende producten");
  await expect(page.getByTestId("hero-cta")).toHaveAttribute("href", "/login");
  await page.getByRole("link", { name: "Privacy" }).last().click();
  await expect(page.getByTestId("legal-page")).toContainText("Je rechten");
  await page.goto("/terms");
  await expect(page.getByTestId("legal-page")).toContainText("Abonnementen en betaling");
  expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
});

test("getting-started checklist reflects progress", async ({ page }) => {
  await login(page);
  const list = page.getByTestId("getting-started");
  await expect(list).toContainText("0 van 5 stappen");
  await page.goto("/assistant");
  await page.getByRole("button", { name: /keukenproducten/ }).click();
  await expect(page).toHaveURL(/\/assistant\?c=/, { timeout: 30_000 });
  await page.goto("/home");
  await expect(list).toContainText("1 van 5 stappen");

  // Gesprek verwijderen (privacy)
  await page.goto("/assistant");
  await expect(page.getByTestId("conversation-list").locator("li")).toHaveCount(1);
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("conversation-list").locator("li").first().hover();
  await page.getByRole("button", { name: "Gesprek verwijderen" }).click();
  await expect(page.getByTestId("conversation-list").locator("li")).toHaveCount(0);
});

test("owner can delete the workspace; the next one has no second trial", async ({ page }) => {
  await login(page);
  await page.goto("/settings");
  const box = page.getByTestId("delete-workspace");
  const name = (await box.getByRole("textbox").getAttribute("placeholder"))!;
  await box.getByRole("textbox").fill("verkeerde naam");
  await box.getByRole("button", { name: "Definitief verwijderen" }).click();
  await expect(box.getByRole("alert")).toContainText("komt niet overeen");
  await box.getByRole("textbox").fill(name);
  await box.getByRole("button", { name: "Definitief verwijderen" }).click();
  await page.waitForURL(/\/home|onboarding/);
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-status")).toContainText("Free");
});
