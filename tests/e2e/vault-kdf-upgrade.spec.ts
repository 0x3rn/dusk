// tests/e2e/vault-kdf-upgrade.spec.ts
// Existing PBKDF2 vaults are upgraded to Argon2id automatically after a successful unlock, with
// nothing lost: the same key is re-wrapped, items stay readable, the recovery kit still works,
// and a failed upgrade never blocks or alarms (it is retried silently at the next unlock).
// Each test uses its own throwaway account and the real legacy vectors (PBKDF2-SHA256, 8-character
// passphrase, legacy recovery kit), seeded the way vault-kdf.spec.ts does.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LEGACY } from "../../lib/crypto/legacy-vectors.fixture";
import {
  expectItemSecretReadable,
  lockVault,
  openDigitalVault,
  readDashboardState,
  registerThrowawayAccount,
  watchPage,
} from "./helpers/vault";

const ITEM_TITLE = "Old bank login";
const ITEM_SECRET = "account 12345, pin 6789";
const UPGRADED_NOTICE = "Your vault now uses stronger protection.";

/**
 * Stores the legacy vault and the legacy recovery kit (the way the earlier code did), then adds one
 * item through the app itself while the upgrade request is blocked, so the item is encrypted by the
 * real app under the legacy vault key and the vault is still on PBKDF2 afterwards.
 */
async function seedLegacyVaultWithItem(page: Page, context: BrowserContext): Promise<void> {
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
  await expect(page.getByRole("button", { name: "Digital vault" }).first()).toBeVisible({ timeout: 30_000 });

  await blockUpgrade(context, "abort");
  await unlockWithPassphrase(page, LEGACY.vaultShort.passphrase);
  await openDigitalVault(page);
  await page.locator("#item-title").fill(ITEM_TITLE);
  await page.locator("#item-content").fill(ITEM_SECRET);
  await page.getByRole("button", { name: "Save to vault" }).click();
  await expect(page.getByText(ITEM_TITLE).first()).toBeVisible({ timeout: 30_000 });
  await expectItemSecretReadable(page, ITEM_SECRET);
  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await page.reload();
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await expect(page.getByRole("button", { name: "Digital vault" }).first()).toBeVisible({ timeout: 30_000 });
  const state = await readDashboardState(page);
  expect(state.vault?.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
  expect(state.vault?.items).toHaveLength(1);
}

async function unlockWithPassphrase(page: Page, passphrase: string): Promise<void> {
  await openDigitalVault(page);
  await page.getByLabel("Master passphrase").fill(passphrase);
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText("Vault unlocked on this device.")).toBeVisible({ timeout: 60_000 });
}

/** Counts upgrade requests the page sends, by looking at the request bodies. */
function countUpgradeRequests(page: Page): { count: () => number } {
  let sent = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/dashboard") && /UPGRADE_VAULT_KDF/.test(request.postData() ?? "")) {
      sent += 1;
    }
  });
  return { count: () => sent };
}

test("an older vault is upgraded to Argon2id on unlock; items and the recovery kit still work", async ({ page, context }) => {
  test.setTimeout(240_000);
  const watchers = await watchPage(page);
  const upgrades = countUpgradeRequests(page);

  await registerThrowawayAccount(page, "upgrade");
  await seedLegacyVaultWithItem(page, context);
  const baseline = upgrades.count(); // the blocked attempt made while seeding
  const seedingErrors = watchers.consoleErrors.length; // the deliberately blocked request logs one

  const before = await readDashboardState(page);
  expect(before.vault?.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
  expect(before.recoveryArtifacts[0]?.kdfAlgorithm).toBe("PBKDF2-SHA256-310000");
  expect(before.vault?.items).toHaveLength(1);
  const itemBefore = JSON.stringify(before.vault?.items);
  const recoveryBefore = JSON.stringify(before.recoveryArtifacts);

  // Unlock with the old, short passphrase: unlocking is immediate, the upgrade follows quietly.
  await unlockWithPassphrase(page, LEGACY.vaultShort.passphrase);
  await expect(page.getByText(UPGRADED_NOTICE)).toBeVisible({ timeout: 60_000 });
  expect(upgrades.count()).toBe(baseline + 1);

  // The server now holds an Argon2id wrap; the salt and wrap are new, everything else is as it was.
  const after = await readDashboardState(page);
  expect(after.vault?.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
  expect(after.vault?.kdfSaltBase64).not.toBe(before.vault?.kdfSaltBase64);
  expect(after.vault?.wrappedMasterKeyCiphertext).not.toBe(before.vault?.wrappedMasterKeyCiphertext);
  expect(JSON.stringify(after.vault?.items)).toBe(itemBefore);
  expect(JSON.stringify(after.recoveryArtifacts)).toBe(recoveryBefore);
  const upgradeEvents = after.auditEvents.filter((e) => e.eventType === "VAULT_KDF_UPGRADED");
  expect(upgradeEvents).toHaveLength(1);
  expect(upgradeEvents[0].redactedMeta).not.toContain(after.vault?.wrappedMasterKeyCiphertext ?? "never");

  // The unlocked vault is intact, and the audit timeline says so in plain words.
  await openDigitalVault(page);
  await expectItemSecretReadable(page, ITEM_SECRET);
  await page.getByRole("button", { name: "Audit timeline" }).first().click();
  await expect(page.getByText("Vault protection strengthened")).toBeVisible({ timeout: 30_000 });

  // Lock, reload, unlock again with the same passphrase (now through Argon2id): no second upgrade.
  await page.getByRole("button", { name: "Lock vault" }).first().click();
  await page.reload();
  await unlockWithPassphrase(page, LEGACY.vaultShort.passphrase);
  await openDigitalVault(page);
  await expectItemSecretReadable(page, ITEM_SECRET);
  expect(upgrades.count()).toBe(baseline + 1);
  await expect(page.getByText(UPGRADED_NOTICE)).toHaveCount(0);

  // A wrong passphrase is still refused after the upgrade.
  await lockVault(page);
  await page.getByLabel("Master passphrase").fill("not the right one");
  await page.getByRole("button", { name: "Unlock vault" }).click();
  await expect(page.getByText(/didn't open your vault/)).toBeVisible({ timeout: 60_000 });

  // The recovery kit made before the upgrade still recovers the vault and the item.
  await page.reload();
  await openDigitalVault(page);
  await page.getByRole("button", { name: /Use your recovery code/ }).click();
  await page.getByLabel("Recovery code").fill(LEGACY.recoveryNoPassphrase.recoveryCode);
  await page.getByRole("button", { name: "Unlock with recovery code" }).click();
  await expect(page.getByText("Vault unlocked with your recovery code.")).toBeVisible({ timeout: 60_000 });
  await openDigitalVault(page);
  await expectItemSecretReadable(page, ITEM_SECRET);

  expect(watchers.violations).toEqual([]);
  expect(watchers.pageErrors).toEqual([]);
  expect(watchers.consoleErrors.slice(seedingErrors)).toEqual([]);
});

async function blockUpgrade(context: BrowserContext, mode: "abort" | "reject"): Promise<void> {
  await context.route("**/api/dashboard", (route) => {
    const request = route.request();
    if (request.method() === "POST" && /UPGRADE_VAULT_KDF/.test(request.postData() ?? "")) {
      return mode === "abort"
        ? route.abort("failed")
        : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down", code: "X" }) });
    }
    return route.continue();
  });
}

test("a failed upgrade never blocks or alarms: the vault stays unlocked and unchanged, and the next unlock retries", async ({ page, context }) => {
  test.setTimeout(240_000);
  const watchers = await watchPage(page, { allow4xx: true });
  const upgrades = countUpgradeRequests(page);

  await registerThrowawayAccount(page, "upgradefail");
  await seedLegacyVaultWithItem(page, context);
  const baseline = upgrades.count();
  const before = await readDashboardState(page);
  const stored = (state: typeof before) =>
    JSON.stringify([state.vault?.kdfAlgorithm, state.vault?.kdfSaltBase64, state.vault?.wrappedMasterKeyCiphertext]);
  const storedBefore = stored(before);

  for (const mode of ["abort", "reject"] as const) {
    await blockUpgrade(context, mode);
    await unlockWithPassphrase(page, LEGACY.vaultShort.passphrase);
    // The upgrade was attempted (and failed), yet: unlocked, readable, no error and no notice.
    await expect.poll(() => upgrades.count(), { timeout: 60_000 }).toBe(baseline + (mode === "abort" ? 1 : 2));
    await openDigitalVault(page);
    await expectItemSecretReadable(page, ITEM_SECRET);
    // (The framework's route announcer is also an empty "alert"; an error notice has text.)
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(page.getByText(UPGRADED_NOTICE)).toHaveCount(0);
    // Nothing changed on the server.
    const during = await readDashboardState(page);
    expect(stored(during)).toBe(storedBefore);
    expect(during.vault?.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    expect(during.auditEvents.some((e) => e.eventType === "VAULT_KDF_UPGRADED")).toBe(false);

    await page.getByRole("button", { name: "Lock vault" }).first().click();
    await page.reload();
    await context.unrouteAll({ behavior: "ignoreErrors" });
  }
  expect(upgrades.count()).toBe(baseline + 2); // one attempt per unlock: it is retried at the next unlock

  // With the block gone, the next unlock completes the upgrade.
  await unlockWithPassphrase(page, LEGACY.vaultShort.passphrase);
  await expect(page.getByText(UPGRADED_NOTICE)).toBeVisible({ timeout: 60_000 });
  expect(upgrades.count()).toBe(baseline + 3);
  const after = await readDashboardState(page);
  expect(after.vault?.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
  await openDigitalVault(page);
  await expectItemSecretReadable(page, ITEM_SECRET);

  expect(watchers.violations).toEqual([]);
  expect(watchers.pageErrors).toEqual([]);
});
