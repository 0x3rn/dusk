// playwright.config.ts
// End-to-end tests drive the real app in a real browser. They run against the dev server
// (which uses the Neon dev branch from .env.local), never production.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Uses the Microsoft Edge that ships with Windows, so nothing needs downloading. Override with
    // E2E_BROWSER=chrome, or E2E_BROWSER=chromium (run `npx playwright install chromium` first).
    channel: process.env.E2E_BROWSER === "chromium" ? undefined : (process.env.E2E_BROWSER ?? "msedge"),
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
