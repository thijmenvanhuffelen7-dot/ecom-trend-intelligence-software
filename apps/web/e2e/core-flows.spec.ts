import { expect, test, type Page } from "@playwright/test";

/** Elke test gebruikt een eigen e-mailadres, zodat workspace en onboarding vers zijn. */
async function login(page: Page, email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@trendscope.dev`) {
  await page.goto("/login");
  await page.getByLabel("E-mailadres").fill(email);
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/onboarding/);
  await page.getByRole("button", { name: /Huid- & lichaamsverzorging/ }).click();
  await page.getByRole("button", { name: /Naar mijn dashboard/ }).click();
  await page.waitForURL(/\/home/);
}

test("redirects anonymous visitors to the login page", async ({ page }) => {
  await page.goto("/explorer/shops");
  await expect(page).toHaveURL(/\/login\?next=%2Fexplorer%2Fshops/);
});

test("rejects an open redirect after login", async ({ page }) => {
  await page.goto("/login?next=//evil.example");
  await page.getByRole("button", { name: "Doorgaan" }).click();
  await page.waitForURL(/localhost/);
  expect(new URL(page.url()).host).toContain("localhost");
});

test("onboarding leads to a personalised dashboard", async ({ page }) => {
  await login(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Goede(morgen|middag|navond)/);
  await expect(page.getByText("Top-opportuniteiten")).toBeVisible();
});

test("shop explorer filters, opens a shop and tracks it in Brandtracker", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops?niche=pets");
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await expect(page.locator("tbody")).toContainText("Huisdieren");

  await rows.first().getByRole("link").first().click();
  await expect(page.getByText("Verkeer door de tijd")).toBeVisible();
  await expect(page.getByText("Gekoppelde trendproducten")).toBeVisible();
  const shopName = await page.getByRole("heading", { level: 1 }).innerText();

  // de knop is optimistisch: wacht op de server action vóór we weg navigeren
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.status() === 200);
  await page.getByRole("button", { name: "Volg in Brandtracker" }).click();
  await saved;
  await expect(page.getByRole("button", { name: "Gevolgd" })).toBeVisible();
  await page.goto("/brandtracker");
  await expect(page.getByRole("link", { name: new RegExp(shopName) })).toBeVisible();
});

test("search narrows the shop list via the URL", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/shops");
  await page.getByPlaceholder("Zoek shops of domeinen…").fill("zzzz-geen-match");
  await expect(page).toHaveURL(/q=zzzz-geen-match/);
  await expect(page.getByText("Geen resultaten voor deze filters")).toBeVisible();
});

test("product detail explains the score", async ({ page }) => {
  await login(page);
  await page.goto("/explorer/products");
  await page.locator("tbody tr").first().getByRole("link").first().click();
  await expect(page.getByText("Waarom deze score?")).toBeVisible();
  await expect(page.getByText(/\d+ positieve signalen$/).first()).toBeVisible();
  await expect(page.getByText("Margecalculator")).toBeVisible();
});

test("CSV export returns the filtered shops", async ({ page }) => {
  await login(page);
  const res = await page.request.get("/api/export/shops?niche=pets");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");
  const body = await res.text();
  expect(body.split("\r\n")[0]).toBe("domain,name,country,niches,launched_at,monthly_visits_est,visits_growth_pct,live_ads,ads_growth_30d_pct,products");
  expect(body.split("\r\n").length).toBeGreaterThan(2);
});

test("health endpoint reports both databases", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(await res.json()).toMatchObject({ status: "ok", postgres: "ok", clickhouse: "ok" });
});
