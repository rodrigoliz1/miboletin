import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Configura E2E_DATABASE_URL o DATABASE_URL antes de ejecutar Playwright");

const baseURL = "http://localhost:3100";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm start --port 3100",
    url: baseURL,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "e2e-secret-not-for-deployment-2026",
      E2E_TEST_MODE: "1",
      APP_URL: baseURL,
    },
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
});
