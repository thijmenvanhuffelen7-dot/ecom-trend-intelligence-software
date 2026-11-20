import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(`e2e-ads-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("ad views and platform filter", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/ads");
  await page.getByRole("button", { name: /Schalend/ }).click();
  await expect(page).toHaveURL(/view=scaling/);
  await expect(page.locator("article").first()).toBeVisible();
  await page.goto("/explorer/ads?platform=tiktok");
  await expect(page.locator("article").first()).toContainText("TikTok");
});

test("ad detail shows estimates, variants and linked products", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/ads?platform=meta&view=scaling");
  await page.locator("article a[aria-label]").first().click();
  await expect(page).toHaveURL(/\/explorer\/ads\/\d+/);
  await expect(page.getByText("Varianten van deze creative")).toBeVisible();
  await expect(page.getByText("Gekoppelde producten")).toBeVisible();
  await expect(page.getByText(/Meta EU-transparantie/).first()).toBeVisible();
});

test("advertiser profile lists its ads", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/advertisers");
  const href = await page.locator("tbody tr").first().getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/explorer\/advertisers\/\d+$/);
  await page.goto(href!);
  await expect(page.getByText("Actieve ads door de tijd")).toBeVisible();
  await expect(page.locator("article").first()).toBeVisible();
});

test("save an ad to a new board, tag it and filter by tag", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/ads");
  await page.locator("article").first().getByRole("button", { name: "Opslaan in board" }).click();
  await page.getByPlaceholder("Naam van het board").fill("Hooks die werken");
  await page.getByRole("button", { name: "Aanmaken" }).click();
  await expect(page.getByRole("button", { name: /Hooks die werken/ })).toBeVisible();

  await page.goto("/boards");
  await page.getByRole("link", { name: /Hooks die werken/ }).click();
  await expect(page.locator("article")).toHaveCount(1);
  const note = page.getByPlaceholder("Waarom is deze ad interessant?");
  await note.fill("Sterke hook in de eerste seconde");
  // notitie wordt opgeslagen bij het verlaten van het veld; wacht op die server action
  const savedNote = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByPlaceholder("Tag toevoegen…").click();
  await savedNote;
  const savedTag = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByPlaceholder("Tag toevoegen…").fill("ugc");
  await page.getByPlaceholder("Tag toevoegen…").press("Enter");
  await savedTag;
  await expect(page.getByText("#ugc").first()).toBeVisible();
  await page.reload();
  await expect(page.getByPlaceholder("Waarom is deze ad interessant?")).toHaveValue("Sterke hook in de eerste seconde");
  await page.getByRole("link", { name: "#ugc" }).click();
  await expect(page.locator("article")).toHaveCount(1);
});

test("boards are isolated per workspace", async ({ page, browser }) => {
  await login(page);
  await page.goto("/boards");
  await page.getByPlaceholder("Naam van het board").fill("Geheim board");
  await page.getByRole("button", { name: "Nieuw board" }).click();
  await page.waitForURL(/\/boards\/[0-9a-f-]{36}/);
  const url = page.url();

  const other = await browser.newPage();
  await login(other);
  await other.goto(url);
  await expect(other.getByRole("heading", { name: "404" })).toBeVisible();
  await other.close();
});

test("media proxy requires a session and rejects arbitrary keys", async ({ request, page }) => {
  const anon = await request.get("/api/media/creatives/aa/" + "a".repeat(64) + ".png");
  expect(anon.status()).toBe(401);
  await login(page);
  const bad = await page.request.get("/api/media/../../etc/passwd");
  expect([400, 404]).toContain(bad.status());
  const svg = await page.request.get("/api/media/creatives/aa/" + "a".repeat(64) + ".svg");
  expect(svg.status()).toBe(404);
});
