// tests/e2e/helpers/vault.ts
// Shared steps for the vault browser tests: throwaway accounts, the vault page, and watchers for
// Content-Security-Policy violations and console errors. Every account is created on localhost
// against the dev database branch and is named worker.test.<label>.<timestamp>@example.com.
import { expect, type Page } from "@playwright/test";

export const ACCOUNT_PASSWORD = "A-long-test-passphrase-2026!";

export async function registerThrowawayAccount(page: Page, label: string): Promise<void> {
  const email = `worker.test.${label}.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Worker Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Digital vault" }).first()).toBeVisible({ timeout: 30_000 });
}

export async function openDigitalVault(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Digital vault" }).first().click();
}

export interface Watchers {
  violations: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Records securitypolicyviolation events (registered before any page script runs), console
 * errors and uncaught page errors. 4xx resource loads are ignored when `allow4xx` is set, for
 * tests that provoke a refusal on purpose.
 */
export async function watchPage(page: Page, options: { allow4xx?: boolean } = {}): Promise<Watchers> {
  const watchers: Watchers = { violations: [], consoleErrors: [], pageErrors: [] };
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${event.lineNumber}`
      );
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.startsWith("CSP violation")) watchers.violations.push(text);
    if (options.allow4xx && /Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    watchers.consoleErrors.push(text);
  });
  page.on("pageerror", (error) => watchers.pageErrors.push(error.message));
  return watchers;
}

export async function createVault(page: Page, passphrase: string): Promise<string> {
  await openDigitalVault(page);
  await expect(page.getByText("Create your master passphrase")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Master passphrase").fill(passphrase);
  await page.getByLabel("Type it again").fill(passphrase);
  await page.getByRole("button", { name: "Create vault" }).click();
  const codeBox = page.locator("div.font-mono").filter({ hasText: /^DUSK(-[0-9A-Z]{4}){8}$/ });
  await expect(codeBox).toBeVisible({ timeout: 60_000 });
  return (await codeBox.innerText()).trim();
}

export async function lockVault(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await expect(page.getByLabel("Master passphrase")).toBeVisible();
}

/** Shows the item's details if they are hidden, then expects the secret text. */
export async function expectItemSecretReadable(page: Page, secret: string): Promise<void> {
  const show = page.getByRole("button", { name: "Show details" }).first();
  await expect(page.getByRole("button", { name: /(Show|Hide) details/ }).first()).toBeVisible({ timeout: 30_000 });
  if (await show.isVisible()) await show.click();
  await expect(page.getByText(secret)).toBeVisible();
}

export interface DashboardVaultState {
  vault: { id: string; kdfAlgorithm: string; kdfSaltBase64: string; wrappedMasterKeyCiphertext: string; items: unknown[] } | null;
  recoveryArtifacts: Array<{ kdfAlgorithm: string; recoveryWrappedVmKBase64: string; kdfSaltBase64: string }>;
  auditEvents: Array<{ eventType: string; redactedMeta: string }>;
}

export async function readDashboardState(page: Page): Promise<DashboardVaultState> {
  return page.evaluate(async () => {
    const res = await fetch("/api/dashboard");
    return (await res.json()) as DashboardVaultState;
  });
}
