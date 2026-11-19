import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "nl-NL",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 }, launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {} },
    },
  ],
  webServer: {
    command: process.env.E2E_DEV ? `pnpm next dev --port ${PORT}` : `pnpm next start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
