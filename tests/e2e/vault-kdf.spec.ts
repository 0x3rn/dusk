// tests/e2e/vault-kdf.spec.ts
// A new vault is created with Argon2id and a 12+ character passphrase; vaults and recovery kits
// made by the earlier code (PBKDF2-SHA256) still unlock. Each test uses its own throwaway account.
import { expect, test, type Page } from "@playwright/test";
import { LEGACY } from "../../lib/crypto/legacy-vectors.fixture";

const ACCOUNT_PASSWORD = "A-long-test-passphrase-2026!";
const NEW_PASSPHRASE = "twelve chars+ passphrase";

async function registerThrowawayAccount(page: Page, label: string): Promise<void> {
  const email = `hardening.test.${label}.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Hardening Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function openDigitalVault(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Digital vault" }).first().click();
}

/** Shows the item's details if they are hidden (the page may keep them open across a lock). */
async function expectItemSecretReadable(page: Page, secret: string): Promise<void> {
  const show = page.getByRole("button", { name: "Show details" }).first();
  await expect(page.getByRole("button", { name: /(Show|Hide) details/ }).first()).toBeVisible({ timeout: 30_000 });
  if (await show.isVisible()) await show.click();
  await expect(page.getByText(secret)).toBeVisible();
}

async function readDashboardState(page: Page) {
  return page.evaluate(async () => {
    const res = await fetch("/api/dashboard");
    return (await res.json()) as {
      vault: { kdfAlgorithm: string; kdfSaltBase64: string } | null;
      recoveryArtifacts: Array<{ kdfAlgorithm: string }>;
    };
  });
}

test("a new vault uses Argon2id, rejects an 11-character passphrase, locks, unlocks, stores an item and recovers from the kit", async ({ page }) => {
  test.setTimeout(180_000);
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 4\d\d/.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const vaultCreations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/dashboard") && /INIT_VAULT/.test(request.postData() ?? "")) {
      vaultCreations.push(request.url());
    }
  });

  await registerThrowawayAccount(page, "argon");
  await openDigitalVault(page);
  await expect(page.getByText("Create your master passphrase")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/At least 12 characters/)).toBeVisible();

  // 11 characters: refused in the form, with a plain message, and nothing is sent to the server.
  const eleven = "elevenchars";
  expect(eleven).toHaveLength(11);
  await page.getByLabel("Master passphrase").fill(eleven);
  await page.getByLabel("Type it again").fill(eleven);
  await page.getByRole("button", { name: "Create vault" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "at least 12 characters" })).toBeVisible();
  expect(vaultCreations).toHaveLength(0);

  // 12 characters but typed differently the second time: also refused.
  await page.getByLabel("Master passphrase").fill("twelve-chars");
  await page.getByLabel("Type it again").fill("twelve-charz");
  await page.getByRole("button", { name: "Create vault" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  expect(vaultCreations).toHaveLength(0);

  // A proper passphrase creates the vault and shows the recovery code once.
  await page.getByLabel("Master passphrase").fill(NEW_PASSPHRASE);
  await page.getByLabel("Type it again").fill(NEW_PASSPHRASE);
  await page.getByRole("button", { name: "Create vault" }).click();
  const codeBox = page.locator("div.font-mono").filter({ hasText: /^DUSK(-[0-9A-Z]{4}){8}$/ });
  await expect(codeBox).toBeVisible({ timeout: 60_000 });
  const recoveryCode = (await codeBox.innerText()).trim();
  expect(vaultCreations).toHaveLength(1);

  // The stored labels name the algorithm that really ran.
  const state = await readDashboardState(page);
  expect(state.vault?.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
  expect(state.recoveryArtifacts[0]?.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");

  // Add and read an item while unlocked.
  await openDigitalVault(page);
  await page.locator("#item-title").fill("Bank login");
  await page.locator("#item-content").fill("account 12345, pin 6789");
  await page.getByRole("button", { name: "Save to vault" }).click();
  await expect(page.getByText("Bank login").first()).toBeVisible({ timeout: 30_000 });
  await expectItemSecretReadable(page, "account 12345, pin 6789");

  // Lock, then unlock with the passphrase: a wrong one first.
  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await expect(page.getByLabel("Master passphrase")).toBeVisible();
  await page.getByLabel("Master passphrase").fill("not the right one!");
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText(/didn't open your vault/)).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Master passphrase").fill(NEW_PASSPHRASE);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText("Vault unlocked on this device.")).toBeVisible({ timeout: 60_000 });
  await openDigitalVault(page);
  await expectItemSecretReadable(page, "account 12345, pin 6789");

  // Lock, reload (so nothing is left in memory), and recover with the recovery code.
  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await page.reload();
  await openDigitalVault(page);
  await page.getByRole("button", { name: /Use your recovery code/ }).click();
  await page.getByLabel("Recovery code").fill(recoveryCode.toLowerCase());
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByText("Vault unlocked with your recovery code.")).toBeVisible({ timeout: 60_000 });
  await openDigitalVault(page);
  await expectItemSecretReadable(page, "account 12345, pin 6789");

  expect(violations).toEqual([]);
});

test("a vault and recovery kit made by the earlier code (PBKDF2-SHA256, 8-character passphrase) still unlock", async ({ page }) => {
  test.setTimeout(120_000);
  await registerThrowawayAccount(page, "legacy");
  await expect(page.getByRole("button", { name: "Digital vault" }).first()).toBeVisible({ timeout: 30_000 });

  // Seed the account the way the earlier code stored it: through the same API the page uses.
  const seeded = await page.evaluate(async (legacy) => {
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "INIT_VAULT",
        vaultBundle: {
          wrappedMasterKeyCiphertext: legacy.vaultShort.bundle.wrappedMasterKeyCiphertext,
          wrappedMasterKeyIv: legacy.vaultShort.bundle.wrappedMasterKeyIv,
          kdfSaltBase64: legacy.vaultShort.bundle.kdfSaltBase64,
          kdfAlgorithm: legacy.vaultShort.bundle.kdfAlgorithm,
        },
        recoveryServerArtifact: legacy.recoveryNoPassphrase.artifact,
      }),
    });
    return res.status;
  }, LEGACY);
  expect(seeded).toBeLessThan(300);

  await page.reload();
  const state = await readDashboardState(page);
  expect(state.vault?.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
  expect(state.recoveryArtifacts[0]?.kdfAlgorithm).toBe("PBKDF2-SHA256-310000");

  await openDigitalVault(page);
  await page.getByLabel("Master passphrase").fill(LEGACY.vaultShort.passphrase);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText("Vault unlocked on this device.")).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await page.reload();
  await openDigitalVault(page);
  await page.getByRole("button", { name: /Use your recovery code/ }).click();
  await page.getByLabel("Recovery code").fill(LEGACY.recoveryNoPassphrase.recoveryCode);
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByText("Vault unlocked with your recovery code.")).toBeVisible({ timeout: 60_000 });
});
