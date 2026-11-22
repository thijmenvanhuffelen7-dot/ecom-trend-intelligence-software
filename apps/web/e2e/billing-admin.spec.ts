import { expect, test, type Page } from "@playwright/test";

const uniq = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function login(page: Page, email = `e2e-bill-${uniq()}@trendscope.dev`, onboard = true) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  if (onboard) {
    await page.waitForURL(/onboarding/);
    await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
    await page.waitForURL(/\/home/);
  }
  return email;
}

test("public pricing page, then demo checkout updates plan, status and invoices", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByTestId("pricing-table")).toContainText("Agency/Business");
  await page.getByRole("tab", { name: /Jaarlijks/ }).click();
  await expect(page.getByTestId("pricing-table")).toContainText("/ jaar");

  await login(page);
  await page.goto("/pricing");
  // Nieuwe workspaces zitten in een Pro-trial
  await expect(page.getByText("Huidig plan")).toBeVisible();
  await page.getByRole("button", { name: "Kies Agency/Business" }).click();
  await page.waitForURL(/settings\/billing\?demo=1/);
  await expect(page.getByTestId("billing-status")).toContainText("Demo-abonnement");
  await expect(page.getByTestId("invoices")).toContainText("DEMO-");
  await expect(page.getByTestId("usage")).toContainText("15"); // seats op Business
});

test("admin: plan override, weights version and feature flag", async ({ page }) => {
  const email = await login(page);
  await page.goto("/admin?tab=users");
  await page.getByPlaceholder("Zoek op workspace of e-mail").fill(email);
  const row = page.getByTestId("admin-users").locator("tbody tr").filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByLabel("Plan").selectOption("starter");
  await expect(row.getByLabel("Opgeslagen")).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByText("starter", { exact: false }).first()).toBeVisible();

  await page.goto("/admin?tab=weights");
  const editor = page.getByTestId("weights-editor");
  await editor.getByLabel("Reddit").fill("0.4");
  await editor.getByPlaceholder(/Notitie/).fill(`e2e ${uniq()}`);
  await editor.getByRole("button", { name: "Opslaan als concept" }).click();
  await expect(editor.getByRole("status")).toContainText(/Versie \d+ opgeslagen/);
  await expect(page.getByTestId("weights-versions")).toContainText("Activeren");

  await page.goto("/admin?tab=flags");
  await expect(page.getByTestId("flag-public_api")).toBeVisible();
  const key = `e2e_${uniq().replace(/-/g, "_")}`;
  const form = page.getByTestId("flag-new");
  await form.getByLabel("Sleutel").fill(key);
  await form.getByRole("button", { name: "Toevoegen" }).click();
  await expect(page.getByTestId(`flag-${key}`)).toBeVisible();
  await page.getByTestId(`flag-${key}`).getByRole("button", { name: "Verwijderen" }).click();
  await expect(page.getByTestId(`flag-${key}`)).toHaveCount(0);
});

test("admin: curate a product so it shows as winning in the explorer", async ({ page }) => {
  await login(page);
  await page.goto("/admin?tab=curation");
  const first = page.getByTestId("curation-candidates").locator("li").first();
  const title = (await first.getByRole("link").textContent())!.trim();
  await first.getByRole("button", { name: "Uitlichten" }).click();
  await expect(page.getByTestId("curated-list")).toContainText(title);
  await page.goto(`/explorer/products?curated=1&q=${encodeURIComponent(title)}`);
  await expect(page.locator("tbody tr").first()).toContainText(title);
  // Terugzetten zodat andere tests niet afhangen van deze toestand
  await page.goto("/admin?tab=curation");
  await page.getByTestId("curated-list").locator("li").filter({ hasText: title }).getByRole("button", { name: "Niet meer uitlichten" }).click();
  await expect(page.getByTestId("curated-list").locator("li").filter({ hasText: title })).toHaveCount(0);
});

test("non-admins get a 404 on /admin", async ({ page }) => {
  await login(page, `e2e-plain-${uniq()}@example.com`);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
});

test("free plan: the daily search limit shows an upsell instead of results for the query", async ({ page }) => {
  const email = await login(page);
  // Workspace naar Free zetten via het admin-paneel (de e2e-gebruiker is platformbeheerder via PLATFORM_ADMIN_EMAILS)
  await page.goto(`/admin?tab=users&q=${encodeURIComponent(email)}`);
  await page.getByTestId("admin-users").locator("tbody tr").filter({ hasText: email }).getByLabel("Plan").selectOption("free");
  await expect(page.getByTestId("admin-users").getByLabel("Opgeslagen")).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.goto(`/explorer/products?q=mix${i}`);
    await expect(page.getByTestId("limit-banner")).toHaveCount(0);
  }
  await page.goto("/explorer/products?q=one-too-many");
  await expect(page.getByTestId("limit-banner")).toContainText("maximum aantal zoekopdrachten");
});

test("team: invite a colleague, who accepts and can switch workspaces", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  await login(owner);
  const colleague = `e2e-mate-${uniq()}@example.com`;
  await owner.goto("/settings");
  const form = owner.getByTestId("invite-form");
  await form.getByLabel("E-mailadres").fill(colleague);
  await form.getByRole("button", { name: "Uitnodigen" }).click();
  const link = (await owner.getByTestId("invite-link").textContent())!.trim();
  await expect(owner.getByTestId("pending-invite")).toContainText(colleague);

  // Iemand anders kan de link niet gebruiken
  const strangerCtx = await browser.newContext();
  const stranger = await strangerCtx.newPage();
  await login(stranger, `e2e-stranger-${uniq()}@example.com`);
  await stranger.goto(new URL(link).pathname);
  await expect(stranger.getByTestId("invite-page")).toContainText("ander e-mailadres");

  const mateCtx = await browser.newContext();
  const mate = await mateCtx.newPage();
  await mate.goto(new URL(link).pathname);
  await mate.waitForURL(/login/);
  await mate.getByLabel("E-mailadres").fill(colleague);
  await mate.getByRole("button", { name: "Doorgaan" }).click();
  await mate.waitForURL(/invite\//);
  await mate.getByRole("button", { name: "Accepteren en openen" }).click();
  await mate.waitForURL(/onboarding/);
  await mate.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await mate.waitForURL(/\/home/);
  await mate.goto("/settings");
  await expect(mate.getByText("Jouw workspaces")).toBeVisible();
  await expect(mate.getByTestId("team-section")).toContainText(colleague);

  await owner.reload();
  await expect(owner.getByTestId("team-section")).toContainText(colleague);
  await expect(owner.getByTestId("pending-invite")).toHaveCount(0);
  await Promise.all([ownerCtx.close(), strangerCtx.close(), mateCtx.close()]);
});
