// lib/crypto/kdf-compat.test.ts
// Argon2id for new vaults and recovery kits, with proof that vaults and kits created by the
// earlier code (PBKDF2-SHA256) still open unchanged, and that tampering never weakens or
// silently opens anything.
import { describe, expect, it } from "vitest";
import {
  CryptoTamperOrAuthError,
  bytesToBase64,
  createAndWrapVaultMasterKey,
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  unwrapVaultMasterKeyWithPassphrase,
  wrapVaultMasterKeyWithPassphrase,
} from "./vault-crypto";
import {
  createRecoveryKitForVault,
  recoverVaultMasterKeyFromKit,
  rewrapRecoveredMasterKeyWithNewPassphrase,
  type RecoveryServerArtifact,
} from "./recovery-kit";
import { KdfParameterError } from "./kdf";
import { LEGACY } from "./legacy-vectors.fixture";
import { WeakPassphraseError } from "./passphrase-policy";

const GOOD_PASSPHRASE = "a fresh twelve+ passphrase";
const VAULT_ID = "vlt_primary";

function flipFirstChar(base64: string): string {
  const first = base64[0] === "A" ? "B" : "A";
  return first + base64.slice(1);
}

describe("existing (legacy PBKDF2-SHA256) vaults and recovery kits keep opening", () => {
  it("unlocks a vault made with the old 8-character minimum", async () => {
    const vmk = await unwrapVaultMasterKeyWithPassphrase(LEGACY.vaultShort.bundle, LEGACY.vaultShort.passphrase, LEGACY.vaultId);
    expect(vmk).toBe(LEGACY.vaultMasterKeyBase64);
  });

  it("unlocks a vault made with a longer passphrase", async () => {
    const vmk = await unwrapVaultMasterKeyWithPassphrase(LEGACY.vaultLong.bundle, LEGACY.vaultLong.passphrase, LEGACY.vaultId);
    expect(vmk).toBe(LEGACY.vaultMasterKeyBase64);
  });

  it("still refuses the wrong passphrase on a legacy vault", async () => {
    await expect(
      unwrapVaultMasterKeyWithPassphrase(LEGACY.vaultShort.bundle, "oldpass9", LEGACY.vaultId)
    ).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(
      unwrapVaultMasterKeyWithPassphrase(LEGACY.vaultShort.bundle, "", LEGACY.vaultId)
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("an item sealed under the legacy vault key is readable after unlocking it", async () => {
    const vmk = await unwrapVaultMasterKeyWithPassphrase(LEGACY.vaultShort.bundle, LEGACY.vaultShort.passphrase, LEGACY.vaultId);
    const { bundle } = await encryptVaultItemPayload({ payload: { note: "legacy" }, vaultMasterKeyBase64: vmk, vaultId: VAULT_ID, itemId: "itm_1" });
    expect((await decryptVaultItemPayload({ bundle, vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64 })).payload).toEqual({ note: "legacy" });
  });

  it("recovers the vault key from a legacy recovery kit (no kit passphrase)", async () => {
    const { artifact, recoveryCode } = LEGACY.recoveryNoPassphrase;
    expect(await recoverVaultMasterKeyFromKit({ serverArtifact: artifact, recoveryCode })).toBe(LEGACY.vaultMasterKeyBase64);
  });

  it("recovers the vault key from a legacy recovery kit that has a kit passphrase", async () => {
    const { artifact, recoveryCode, recoveryPassphrase } = LEGACY.recoveryWithPassphrase;
    expect(await recoverVaultMasterKeyFromKit({ serverArtifact: artifact, recoveryCode, recoveryPassphrase })).toBe(
      LEGACY.vaultMasterKeyBase64
    );
    await expect(recoverVaultMasterKeyFromKit({ serverArtifact: artifact, recoveryCode })).rejects.toThrow(/kit passphrase/);
    await expect(
      recoverVaultMasterKeyFromKit({ serverArtifact: artifact, recoveryCode, recoveryPassphrase: "wrong" })
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("a legacy kit can be re-wrapped under a new passphrase, which then uses Argon2id", async () => {
    const { artifact, recoveryCode } = LEGACY.recoveryNoPassphrase;
    const { recoveredMasterKeyBase64, newWrappedMasterKeyBundle } = await rewrapRecoveredMasterKeyWithNewPassphrase({
      serverArtifact: artifact,
      recoveryCode,
      newMasterPassphrase: GOOD_PASSPHRASE,
    });
    expect(recoveredMasterKeyBase64).toBe(LEGACY.vaultMasterKeyBase64);
    expect(newWrappedMasterKeyBundle.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
    expect(await unwrapVaultMasterKeyWithPassphrase(newWrappedMasterKeyBundle, GOOD_PASSPHRASE, VAULT_ID)).toBe(
      LEGACY.vaultMasterKeyBase64
    );
  });
});

describe("new vaults use Argon2id and label it truthfully", () => {
  it("creates, locks and unlocks with the stored identifier ARGON2ID-19456-2-1", async () => {
    const { masterKeyBase64, wrappedBundle } = await createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID);
    expect(wrappedBundle.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
    expect("kdfIterations" in wrappedBundle).toBe(false);
    expect(await unwrapVaultMasterKeyWithPassphrase(wrappedBundle, GOOD_PASSPHRASE, VAULT_ID)).toBe(masterKeyBase64);
  });

  it("the stored identifier matches the algorithm that really ran (independent re-derivation)", async () => {
    const { masterKeyBase64, wrappedBundle } = await createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID);
    // Re-wrap the same key with an explicit PBKDF2 policy and the same salt: it must be labelled
    // PBKDF2, and the Argon2id ciphertext must not open with a PBKDF2-labelled copy of itself.
    const pbkdf2 = await wrapVaultMasterKeyWithPassphrase(
      masterKeyBase64,
      GOOD_PASSPHRASE,
      VAULT_ID,
      1,
      wrappedBundle.kdfSaltBase64,
      { kdf: { algorithm: "PBKDF2-SHA256", iterations: 1_000 }, policy: { pbkdf2MinIterations: 1_000 } }
    );
    expect(pbkdf2.kdfAlgorithm).toBe("PBKDF2-SHA256-1000");
    await expect(
      unwrapVaultMasterKeyWithPassphrase(
        { ...wrappedBundle, kdfAlgorithm: "PBKDF2-SHA256-600000" },
        GOOD_PASSPHRASE,
        VAULT_ID
      )
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("uses a fresh salt, IV and wrapped key every time", async () => {
    const a = await createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID);
    const b = await createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID);
    expect(a.wrappedBundle.kdfSaltBase64).not.toBe(b.wrappedBundle.kdfSaltBase64);
    expect(a.wrappedBundle.wrappedMasterKeyIv).not.toBe(b.wrappedBundle.wrappedMasterKeyIv);
    expect(a.masterKeyBase64).not.toBe(b.masterKeyBase64);
  });

  it("rejects a passphrase of 11 characters and accepts 12 for new vaults", async () => {
    await expect(createAndWrapVaultMasterKey("a".repeat(11), VAULT_ID)).rejects.toThrow(WeakPassphraseError);
    await expect(createAndWrapVaultMasterKey("abcdefgh", VAULT_ID)).rejects.toThrow(WeakPassphraseError);
    const { wrappedBundle, masterKeyBase64 } = await createAndWrapVaultMasterKey("a".repeat(12), VAULT_ID);
    expect(await unwrapVaultMasterKeyWithPassphrase(wrappedBundle, "a".repeat(12), VAULT_ID)).toBe(masterKeyBase64);
  });

  it("the 12-character rule also guards re-wrapping under a new passphrase", async () => {
    await expect(
      wrapVaultMasterKeyWithPassphrase(LEGACY.vaultMasterKeyBase64, "short-11-ch", VAULT_ID, 1, LEGACY.vaultShort.bundle.kdfSaltBase64)
    ).rejects.toThrow(WeakPassphraseError);
  });

  it("treats the passphrase as Unicode text normalised to NFKC", async () => {
    const composed = "pässphrase-café-ok"; // a-umlaut and e-acute as single characters
    const decomposed = "pässphrase-café-ok"; // the same text with combining accents
    const { wrappedBundle, masterKeyBase64 } = await createAndWrapVaultMasterKey(composed, VAULT_ID);
    expect(await unwrapVaultMasterKeyWithPassphrase(wrappedBundle, decomposed, VAULT_ID)).toBe(masterKeyBase64);
  });

  it("refuses to create a vault with parameters below the floor or above the ceiling", async () => {
    await expect(
      createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID, { kdf: { algorithm: "ARGON2ID", memoryKiB: 1024, timeCost: 1, parallelism: 1 } })
    ).rejects.toThrow(KdfParameterError);
    await expect(
      createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID, { kdf: { algorithm: "PBKDF2-SHA256", iterations: 1_000 } })
    ).rejects.toThrow(KdfParameterError);
  });
});

describe("tampering and downgrade attempts on a new (Argon2id) vault", () => {
  async function newVault() {
    return createAndWrapVaultMasterKey(GOOD_PASSPHRASE, VAULT_ID);
  }

  it("fails closed for a wrong passphrase, vault id or key version", async () => {
    const { wrappedBundle } = await newVault();
    await expect(unwrapVaultMasterKeyWithPassphrase(wrappedBundle, GOOD_PASSPHRASE + "!", VAULT_ID)).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(unwrapVaultMasterKeyWithPassphrase(wrappedBundle, GOOD_PASSPHRASE, "vlt_other")).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(
      unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, keyVersion: 2 }, GOOD_PASSPHRASE, VAULT_ID)
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("fails closed when the salt, ciphertext or IV is modified", async () => {
    const { wrappedBundle } = await newVault();
    await expect(
      unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfSaltBase64: flipFirstChar(wrappedBundle.kdfSaltBase64) }, GOOD_PASSPHRASE, VAULT_ID)
    ).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(
      unwrapVaultMasterKeyWithPassphrase(
        { ...wrappedBundle, wrappedMasterKeyCiphertext: flipFirstChar(wrappedBundle.wrappedMasterKeyCiphertext) },
        GOOD_PASSPHRASE,
        VAULT_ID
      )
    ).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(
      unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, wrappedMasterKeyIv: flipFirstChar(wrappedBundle.wrappedMasterKeyIv) }, GOOD_PASSPHRASE, VAULT_ID)
    ).rejects.toThrow(CryptoTamperOrAuthError);
    // A salt that is too short is refused outright.
    await expect(
      unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfSaltBase64: bytesToBase64(new Uint8Array(8).fill(1)) }, GOOD_PASSPHRASE, VAULT_ID)
    ).rejects.toThrow(KdfParameterError);
  });

  it("changing any accepted Argon2id parameter changes the key, so the vault does not open", async () => {
    const { wrappedBundle } = await newVault();
    for (const id of ["ARGON2ID-19457-2-1", "ARGON2ID-32768-2-1", "ARGON2ID-19456-3-1", "ARGON2ID-19456-2-2"]) {
      await expect(
        unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfAlgorithm: id }, GOOD_PASSPHRASE, VAULT_ID),
        id
      ).rejects.toThrow(CryptoTamperOrAuthError);
    }
  });

  it("a downgrade of the algorithm name never opens the vault", async () => {
    const { wrappedBundle } = await newVault();
    // Server pretends the vault is a legacy PBKDF2 vault (or one with a weaker setting).
    await expect(
      unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfAlgorithm: "PBKDF2-SHA256-600000" }, GOOD_PASSPHRASE, VAULT_ID)
    ).rejects.toThrow(CryptoTamperOrAuthError);
    // Values below the floor are not even attempted.
    for (const id of ["PBKDF2-SHA256-1000", "PBKDF2-SHA256-1", "ARGON2ID-8192-2-1", "ARGON2ID-19456-1-1"]) {
      await expect(
        unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfAlgorithm: id }, GOOD_PASSPHRASE, VAULT_ID),
        id
      ).rejects.toThrow(KdfParameterError);
    }
  });

  it("and the same in the other direction: a legacy vault relabelled as Argon2id does not open", async () => {
    await expect(
      unwrapVaultMasterKeyWithPassphrase(
        { ...LEGACY.vaultShort.bundle, kdfAlgorithm: "ARGON2ID-19456-2-1" },
        LEGACY.vaultShort.passphrase,
        LEGACY.vaultId
      )
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("rejects absurd server-supplied parameters instantly, without trying to run them", async () => {
    const { wrappedBundle } = await newVault();
    const started = performance.now();
    for (const id of [
      "ARGON2ID-4194304-2-1",
      "ARGON2ID-2147483647-2-1",
      "ARGON2ID-19456-100000-1",
      "PBKDF2-SHA256-2147483647",
      "PBKDF2-SHA256-999999999",
      "SCRYPT-1048576-8-1",
      "",
    ]) {
      await expect(
        unwrapVaultMasterKeyWithPassphrase({ ...wrappedBundle, kdfAlgorithm: id }, GOOD_PASSPHRASE, VAULT_ID),
        id
      ).rejects.toThrow(KdfParameterError);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("new recovery kits use Argon2id and label it truthfully", () => {
  it("creates, recovers, and carries the right identifier without a kit passphrase", async () => {
    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64,
      vaultId: VAULT_ID,
      accountEmail: "owner@example.com",
      keyVersion: 1,
    });
    expect(serverArtifact.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
    expect(clientKit.requiresPassphrase).toBe(false);
    expect(await recoverVaultMasterKeyFromKit({ serverArtifact, recoveryCode: clientKit.recoveryCode })).toBe(LEGACY.vaultMasterKeyBase64);
  });

  it("marks and enforces a kit passphrase", async () => {
    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64,
      vaultId: VAULT_ID,
      accountEmail: "owner@example.com",
      keyVersion: 1,
      recoveryPassphrase: "my kit passphrase",
    });
    expect(serverArtifact.kdfAlgorithm).toBe("ARGON2ID-19456-2-1+PASSPHRASE");
    expect(clientKit.requiresPassphrase).toBe(true);
    const recoveryCode = clientKit.recoveryCode;
    expect(await recoverVaultMasterKeyFromKit({ serverArtifact, recoveryCode, recoveryPassphrase: "my kit passphrase" })).toBe(
      LEGACY.vaultMasterKeyBase64
    );
    await expect(recoverVaultMasterKeyFromKit({ serverArtifact, recoveryCode })).rejects.toThrow(/kit passphrase/);
    await expect(
      recoverVaultMasterKeyFromKit({ serverArtifact, recoveryCode, recoveryPassphrase: "my kit passphrasE" })
    ).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("rejects tampered or downgraded recovery artifacts", async () => {
    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64,
      vaultId: VAULT_ID,
      accountEmail: "owner@example.com",
      keyVersion: 1,
    });
    const recoveryCode = clientKit.recoveryCode;
    const attempt = (changes: Partial<RecoveryServerArtifact>) =>
      recoverVaultMasterKeyFromKit({ serverArtifact: { ...serverArtifact, ...changes }, recoveryCode });

    // Accepted-but-wrong identifiers change the key: the wrapped key fails authentication.
    await expect(attempt({ kdfAlgorithm: "PBKDF2-SHA256-310000" })).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(attempt({ kdfAlgorithm: "ARGON2ID-19456-3-1" })).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(attempt({ kdfAlgorithm: "ARGON2ID-19456-2-1+PASSPHRASE" })).rejects.toThrow(/kit passphrase/);
    // Weaker or absurd identifiers are refused outright.
    await expect(attempt({ kdfAlgorithm: "PBKDF2-SHA256-1000" })).rejects.toThrow(KdfParameterError);
    await expect(attempt({ kdfAlgorithm: "ARGON2ID-8192-2-1" })).rejects.toThrow(KdfParameterError);
    await expect(attempt({ kdfAlgorithm: "ARGON2ID-4194304-2-1" })).rejects.toThrow(KdfParameterError);
    await expect(attempt({ kdfAlgorithm: "" })).rejects.toThrow(KdfParameterError);
    // Other fields.
    await expect(attempt({ kdfSaltBase64: flipFirstChar(serverArtifact.kdfSaltBase64) })).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(attempt({ recoveryWrappedVmKBase64: flipFirstChar(serverArtifact.recoveryWrappedVmKBase64) })).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(attempt({ vaultId: "vlt_other" })).rejects.toThrow(CryptoTamperOrAuthError);
    await expect(attempt({ keyVersion: 2 })).rejects.toThrow(CryptoTamperOrAuthError);
  });

  it("re-wraps a recovered key under a new 12+ character passphrase, and refuses a short one", async () => {
    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: LEGACY.vaultMasterKeyBase64,
      vaultId: VAULT_ID,
      accountEmail: "owner@example.com",
      keyVersion: 1,
    });
    await expect(
      rewrapRecoveredMasterKeyWithNewPassphrase({ serverArtifact, recoveryCode: clientKit.recoveryCode, newMasterPassphrase: "short-11-ch" })
    ).rejects.toThrow(WeakPassphraseError);
    const { newWrappedMasterKeyBundle } = await rewrapRecoveredMasterKeyWithNewPassphrase({
      serverArtifact,
      recoveryCode: clientKit.recoveryCode,
      newMasterPassphrase: GOOD_PASSPHRASE,
    });
    expect(newWrappedMasterKeyBundle.kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
    expect(await unwrapVaultMasterKeyWithPassphrase(newWrappedMasterKeyBundle, GOOD_PASSPHRASE, VAULT_ID)).toBe(LEGACY.vaultMasterKeyBase64);
  });
});
