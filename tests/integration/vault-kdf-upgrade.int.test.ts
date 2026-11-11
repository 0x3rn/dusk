// tests/integration/vault-kdf-upgrade.int.test.ts
// The server side of the automatic PBKDF2 -> Argon2id upgrade against REAL Postgres (the Neon dev
// branch): the compare-and-swap is exactly-once under concurrency, stale and cross-user requests
// change nothing, weak or malformed settings are refused, and the audit event is written. The
// upgrade requests are produced by the real browser-side code (prepareVaultKdfUpgrade) from the
// real legacy vectors, so the stored result is also proven to unlock and to recover.
import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { upgradeVaultKdf, VaultKdfUpgradeConflictError } from "@/lib/services/vault-kdf-upgrade";
import { parseDashboardAction } from "@/lib/api/dashboard-actions";
import { ValidationError } from "@/lib/auth/security";
import { ARGON2ID_DEFAULT_ALGORITHM_ID } from "@/lib/crypto/kdf";
import { prepareVaultKdfUpgrade, type UpgradeVaultKdfRequest } from "@/lib/crypto/kdf-upgrade";
import { LEGACY } from "@/lib/crypto/legacy-vectors.fixture";
import { recoverVaultMasterKeyFromKit } from "@/lib/crypto/recovery-kit";
import {
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  unwrapVaultMasterKeyWithPassphrase,
} from "@/lib/crypto/vault-crypto";

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

const L = LEGACY.vaultShort.bundle;

/** A user with a legacy PBKDF2 vault, the legacy recovery kit and one encrypted item. */
async function legacyOwner(label: string) {
  const { user } = await createTestUser(label);
  created.push(user.id);
  const vault = await db.vault.create({
    data: {
      userId: user.id,
      currentKeyVersion: L.keyVersion,
      wrappedMasterKeyCiphertext: L.wrappedMasterKeyCiphertext,
      wrappedMasterKeyIv: L.wrappedMasterKeyIv,
      kdfSaltBase64: L.kdfSaltBase64,
      kdfAlgorithm: L.kdfAlgorithm,
    },
  });
  const art = LEGACY.recoveryNoPassphrase.artifact;
  const recovery = await db.recoveryArtifact.create({
    data: {
      userId: user.id,
      keyVersion: art.keyVersion,
      recoveryWrappedVmKBase64: art.recoveryWrappedVmKBase64,
      recoveryWrappedVmKIv: art.recoveryWrappedVmKIv,
      kdfSaltBase64: art.kdfSaltBase64,
      kdfAlgorithm: art.kdfAlgorithm,
      fingerprintHex: art.fingerprintHex,
    },
  });
  const itemId = "itm_upgrade_test";
  const { bundle } = await encryptVaultItemPayload({
    payload: { title: "Bank", content: "pin 6789" },
    vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64,
    vaultId: vault.id,
    itemId,
  });
  const item = await db.encryptedItem.create({
    data: {
      vaultId: vault.id,
      userId: user.id,
      category: "CREDENTIAL",
      keyVersion: bundle.keyVersion,
      ciphertextBase64: bundle.ciphertextBase64,
      ivBase64: bundle.ivBase64,
      wrappedItemKeyBase64: bundle.wrappedItemKeyBase64,
      wrappedItemKeyIvBase64: bundle.wrappedItemKeyIvBase64,
      aadResourceId: itemId,
    },
  });
  return { user, vault, recovery, item };
}

/** What the browser would send for this vault. */
async function prepareRequest(): Promise<UpgradeVaultKdfRequest> {
  const prepared = await prepareVaultKdfUpgrade({
    vault: {
      currentKeyVersion: L.keyVersion,
      kdfAlgorithm: L.kdfAlgorithm,
      kdfSaltBase64: L.kdfSaltBase64,
      wrappedMasterKeyCiphertext: L.wrappedMasterKeyCiphertext,
      wrappedMasterKeyIv: L.wrappedMasterKeyIv,
    },
    vaultId: LEGACY.vaultId,
    passphrase: LEGACY.vaultShort.passphrase,
    masterKeyBase64: LEGACY.vaultMasterKeyBase64,
  });
  if (prepared.status !== "ready") throw new Error("expected an upgrade to be prepared");
  return prepared.request;
}

const auditCount = (userId: string) => db.auditEvent.count({ where: { userId, eventType: "VAULT_KDF_UPGRADED" } });

describe("upgradeVaultKdf (compare-and-swap in Postgres)", () => {
  it("swaps the wrap, writes one audit event, and leaves items and the recovery artifact untouched", async () => {
    const { user, vault, recovery, item } = await legacyOwner("kdf_happy");
    const request = await prepareRequest();

    const result = await upgradeVaultKdf(db, user.id, request);
    expect(result).toEqual({ vaultId: vault.id, kdfAlgorithm: ARGON2ID_DEFAULT_ALGORITHM_ID });

    const after = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(after.kdfAlgorithm).toBe(ARGON2ID_DEFAULT_ALGORITHM_ID);
    expect(after.kdfSaltBase64).toBe(request.next.kdfSaltBase64);
    expect(after.wrappedMasterKeyCiphertext).toBe(request.next.wrappedMasterKeyCiphertext);
    expect(after.wrappedMasterKeyIv).toBe(request.next.wrappedMasterKeyIv);
    expect(after.currentKeyVersion).toBe(1);

    // The stored result unlocks with the same passphrase and gives the same key.
    const vmk = await unwrapVaultMasterKeyWithPassphrase(
      {
        schemaVersion: 1,
        keyVersion: after.currentKeyVersion,
        kdfAlgorithm: after.kdfAlgorithm,
        kdfSaltBase64: after.kdfSaltBase64,
        wrappedMasterKeyCiphertext: after.wrappedMasterKeyCiphertext,
        wrappedMasterKeyIv: after.wrappedMasterKeyIv,
      },
      LEGACY.vaultShort.passphrase,
      LEGACY.vaultId
    );
    expect(vmk).toBe(LEGACY.vaultMasterKeyBase64);

    // Items are byte-identical and still open with that key.
    const itemAfter = await db.encryptedItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(itemAfter).toEqual(item);
    const opened = await decryptVaultItemPayload<{ title: string }>({
      bundle: {
        schemaVersion: itemAfter.schemaVersion,
        keyVersion: itemAfter.keyVersion,
        ciphertextBase64: itemAfter.ciphertextBase64,
        ivBase64: itemAfter.ivBase64,
        wrappedItemKeyBase64: itemAfter.wrappedItemKeyBase64,
        wrappedItemKeyIvBase64: itemAfter.wrappedItemKeyIvBase64,
        aadContext: { vaultId: vault.id, resourceId: itemAfter.aadResourceId, resourceType: "VAULT_ITEM", keyVersion: itemAfter.keyVersion },
      },
      vaultMasterKeyBase64: vmk,
    });
    expect(opened.payload.title).toBe("Bank");

    // The recovery artifact row is unchanged and the kit still recovers the same key.
    const recoveryAfter = await db.recoveryArtifact.findUniqueOrThrow({ where: { id: recovery.id } });
    expect(recoveryAfter).toEqual(recovery);
    const recovered = await recoverVaultMasterKeyFromKit({
      serverArtifact: {
        schemaVersion: 1,
        keyVersion: recoveryAfter.keyVersion,
        vaultId: LEGACY.vaultId,
        recoveryWrappedVmKBase64: recoveryAfter.recoveryWrappedVmKBase64,
        recoveryWrappedVmKIv: recoveryAfter.recoveryWrappedVmKIv,
        kdfSaltBase64: recoveryAfter.kdfSaltBase64,
        kdfAlgorithm: recoveryAfter.kdfAlgorithm,
        fingerprintHex: recoveryAfter.fingerprintHex,
      },
      recoveryCode: LEGACY.recoveryNoPassphrase.recoveryCode,
    });
    expect(recovered).toBe(vmk);

    // Exactly one audit event, in plain terms, with no key material.
    const events = await db.auditEvent.findMany({ where: { userId: user.id, eventType: "VAULT_KDF_UPGRADED" } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ severity: "INFO", actorType: "USER", actorId: user.id });
    const meta = JSON.parse(events[0].redactedMeta) as Record<string, string>;
    expect(meta).toEqual({
      vaultId: vault.id,
      fromKdfAlgorithm: "PBKDF2-SHA256-600000",
      toKdfAlgorithm: ARGON2ID_DEFAULT_ALGORITHM_ID,
    });
    expect(events[0].redactedMeta).not.toContain(request.next.wrappedMasterKeyCiphertext);
    expect(events[0].redactedMeta).not.toContain(request.next.kdfSaltBase64);
  });

  it("exactly one of several concurrent upgrades wins; the rest get a conflict and change nothing", async () => {
    const { user } = await legacyOwner("kdf_race");
    const requests = await Promise.all([prepareRequest(), prepareRequest(), prepareRequest(), prepareRequest(), prepareRequest()]);

    const results = await Promise.allSettled(requests.map((request) => upgradeVaultKdf(db, user.id, request)));
    const winners = results.flatMap((r, i) => (r.status === "fulfilled" ? [i] : []));
    const losers = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) expect(loser.reason).toBeInstanceOf(VaultKdfUpgradeConflictError);

    // The stored vault is exactly the winner's wrap, and only one audit event exists.
    const after = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });
    const winner = requests[winners[0]];
    expect(after.wrappedMasterKeyCiphertext).toBe(winner.next.wrappedMasterKeyCiphertext);
    expect(after.kdfSaltBase64).toBe(winner.next.kdfSaltBase64);
    expect(await auditCount(user.id)).toBe(1);
  });

  it("refuses a stale request (replay) once the vault has moved on, and never overwrites a newer wrap", async () => {
    const { user } = await legacyOwner("kdf_stale");
    const first = await prepareRequest();
    await upgradeVaultKdf(db, user.id, first);
    const stored = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });

    // Another device, still holding the old wrap, tries to upgrade.
    const second = await prepareRequest();
    await expect(upgradeVaultKdf(db, user.id, second)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);
    // Replaying the very same request does nothing either.
    await expect(upgradeVaultKdf(db, user.id, first)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);

    const unchanged = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(unchanged.wrappedMasterKeyCiphertext).toBe(stored.wrappedMasterKeyCiphertext);
    expect(unchanged.kdfSaltBase64).toBe(stored.kdfSaltBase64);
    expect(unchanged.wrappedMasterKeyCiphertext).toBe(first.next.wrappedMasterKeyCiphertext);
    expect(await auditCount(user.id)).toBe(1);
  });

  it("refuses when the old ciphertext, algorithm or key version does not match what is stored", async () => {
    const { user } = await legacyOwner("kdf_mismatch");
    const request = await prepareRequest();
    const otherCiphertext = Buffer.alloc(48, 9).toString("base64");

    const variants: UpgradeVaultKdfRequest[] = [
      { ...request, expected: { ...request.expected, wrappedMasterKeyCiphertext: otherCiphertext } },
      { ...request, expected: { ...request.expected, kdfAlgorithm: "PBKDF2-SHA256-700000" } },
      { ...request, expected: { ...request.expected, keyVersion: 2 } },
    ];
    for (const variant of variants) {
      await expect(upgradeVaultKdf(db, user.id, variant)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);
    }
    const unchanged = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(unchanged.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    expect(unchanged.wrappedMasterKeyCiphertext).toBe(L.wrappedMasterKeyCiphertext);
    expect(await auditCount(user.id)).toBe(0);
  });

  it("cannot be used on another user's vault, even with that vault's exact old values", async () => {
    const owner = await legacyOwner("kdf_owner");
    const attacker = await legacyOwner("kdf_attacker");
    const noVault = await createTestUser("kdf_novault");
    created.push(noVault.user.id);

    // The attacker's own vault has different stored values, so a request built from the owner's
    // values does not match it...
    await db.vault.update({
      where: { userId: attacker.user.id },
      data: { wrappedMasterKeyCiphertext: Buffer.alloc(48, 5).toString("base64") },
    });
    const request = await prepareRequest();
    await expect(upgradeVaultKdf(db, attacker.user.id, request)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);
    // ...and a user with no vault at all gets the same answer.
    await expect(upgradeVaultKdf(db, noVault.user.id, request)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);

    // The owner's vault was never touched by either attempt.
    const ownerVault = await db.vault.findUniqueOrThrow({ where: { userId: owner.user.id } });
    expect(ownerVault.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    expect(ownerVault.wrappedMasterKeyCiphertext).toBe(L.wrappedMasterKeyCiphertext);
    expect(await auditCount(owner.user.id)).toBe(0);
    expect(await auditCount(attacker.user.id)).toBe(0);
    expect(await auditCount(noVault.user.id)).toBe(0);

    // Ownership comes from the session user id, never from the body: an id in the body is rejected.
    expect(() => parseDashboardAction({ ...request, userId: owner.user.id })).toThrow(ValidationError);
  });

  it("refuses malformed or weak key settings, and stores nothing", async () => {
    const { user } = await legacyOwner("kdf_weak");
    const request = await prepareRequest();
    const bad: unknown[] = [
      { ...request, next: { ...request.next, kdfAlgorithm: "PBKDF2-SHA256-600000" } },
      { ...request, next: { ...request.next, kdfAlgorithm: "ARGON2ID-1024-1-1" } },
      { ...request, next: { ...request.next, kdfAlgorithm: "ARGON2ID-19456-2-1' OR '1'='1" } },
      { ...request, next: { ...request.next, kdfAlgorithm: "ARGON2ID-99999999-2-1" } },
      { ...request, next: { ...request.next, kdfAlgorithm: "none" } },
      { ...request, next: { ...request.next, kdfSaltBase64: "AAAA" } },
      { ...request, next: { ...request.next, wrappedMasterKeyIv: Buffer.alloc(16).toString("base64") } },
      { ...request, next: { ...request.next, wrappedMasterKeyCiphertext: Buffer.alloc(10).toString("base64") } },
      { ...request, expected: { ...request.expected, kdfAlgorithm: ARGON2ID_DEFAULT_ALGORITHM_ID } },
      { ...request, expected: undefined },
      {},
      null,
    ];
    for (const body of bad) {
      await expect(upgradeVaultKdf(db, user.id, body)).rejects.toBeInstanceOf(ValidationError);
    }
    const unchanged = await db.vault.findUniqueOrThrow({ where: { userId: user.id } });
    expect(unchanged.kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    expect(unchanged.wrappedMasterKeyCiphertext).toBe(L.wrappedMasterKeyCiphertext);
    expect(await auditCount(user.id)).toBe(0);
  });

  it("a vault already on Argon2id cannot be 'upgraded' again from stale legacy values", async () => {
    const { user } = await legacyOwner("kdf_twice");
    const request = await prepareRequest();
    await upgradeVaultKdf(db, user.id, request);
    // The request that started from the legacy wrap no longer applies to the stored Argon2id wrap.
    await expect(upgradeVaultKdf(db, user.id, request)).rejects.toBeInstanceOf(VaultKdfUpgradeConflictError);
    expect(await auditCount(user.id)).toBe(1);
  });
});
