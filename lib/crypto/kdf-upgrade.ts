// lib/crypto/kdf-upgrade.ts
//
// Automatic upgrade of a vault from PBKDF2-SHA256 to Argon2id, done in the browser right after the
// owner unlocked with their passphrase. Nothing is lost and nothing needs the owner to do
// anything: the SAME Vault Master Key (VMK) is wrapped again under a NEW key-encryption key that
// is derived from the same passphrase with Argon2id and a fresh random salt.
//
//   * Items are encrypted under keys that hang off the VMK, not the passphrase key, so no item
//     ciphertext changes. The recovery artifact wraps the VMK under the recovery code, so it is
//     untouched too.
//   * Before anything is sent, the new bundle is unwrapped with the passphrase and must give back
//     a byte-identical VMK (compared by SHA-256), and, when the vault has an item, that item must
//     still decrypt with the recovered key. If any check fails nothing is sent.
//   * The request names the exact old wrap it started from; the server only swaps if that is
//     still what is stored (compare-and-swap), so two tabs can never overwrite each other.
//   * Failure is never shown as an error: the outcome says why it was skipped, the vault stays
//     unlocked and unchanged, and the next unlock tries again.
//
// Pure functions: no fetch, no React. The caller supplies `send`.

import { ARGON2ID_DEFAULT_ALGORITHM_ID, DEFAULT_ARGON2ID_PARAMS, parseKdfAlgorithm } from "./kdf";
import {
  bytesToBase64,
  bytesToHex,
  base64ToBytes,
  decryptVaultItemPayload,
  rewrapVaultMasterKeyForKdfUpgrade,
  unwrapVaultMasterKeyWithPassphrase,
  type EncryptedItemBundle,
  type PassphraseKdfOptions,
  type WrappedMasterKeyBundle,
} from "./vault-crypto";

/** The part of the stored vault the upgrade starts from. */
export interface VaultKdfState {
  currentKeyVersion: number;
  kdfAlgorithm: string;
  kdfSaltBase64: string;
  wrappedMasterKeyCiphertext: string;
  wrappedMasterKeyIv: string;
}

/** Body of POST /api/dashboard for the UPGRADE_VAULT_KDF action. */
export interface UpgradeVaultKdfRequest {
  action: "UPGRADE_VAULT_KDF";
  /** What the browser started from. The server changes the vault only if it still matches. */
  expected: {
    kdfAlgorithm: string;
    wrappedMasterKeyCiphertext: string;
    keyVersion: number;
  };
  next: {
    kdfAlgorithm: string;
    kdfSaltBase64: string;
    wrappedMasterKeyCiphertext: string;
    wrappedMasterKeyIv: string;
  };
}

export class KdfUpgradeVerificationError extends Error {
  public readonly code = "KDF_UPGRADE_VERIFICATION_FAILED";
  constructor(detail: string) {
    super(`The upgraded key wrap did not verify: ${detail}`);
    this.name = "KdfUpgradeVerificationError";
  }
}

/** True for a vault whose stored algorithm is PBKDF2 (the old scheme). Argon2id vaults are final. */
export function needsKdfUpgrade(kdfAlgorithm: string): boolean {
  try {
    return parseKdfAlgorithm(kdfAlgorithm, "vault-passphrase").params.algorithm === "PBKDF2-SHA256";
  } catch {
    // An identifier we would not even run cannot be upgraded from here.
    return false;
  }
}

export interface PrepareUpgradeInput {
  vault: VaultKdfState;
  /** The id used in the key-wrap authentication context ("vlt_primary" in the app). */
  vaultId: string;
  /** The passphrase that was just used to unlock. Never leaves this function. */
  passphrase: string;
  /** The VMK recovered by that unlock (base64). */
  masterKeyBase64: string;
  /** One existing item, if any, used as an extra check that the VMK still opens real data. */
  sampleItem?: EncryptedItemBundle;
  /** Test-only relaxation of the PBKDF2 floor, passed to every derivation. */
  options?: PassphraseKdfOptions;
}

export type PrepareUpgradeResult =
  | { status: "not-needed" }
  | { status: "ready"; request: UpgradeVaultKdfRequest; newBundle: WrappedMasterKeyBundle };

async function sha256Hex(base64: string): Promise<string> {
  const bytes = base64ToBytes(base64);
  try {
    const copy = bytes.slice().buffer as ArrayBuffer;
    return bytesToHex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", copy)));
  } finally {
    bytes.fill(0);
  }
}

/**
 * Builds and verifies the upgrade. Throws KdfUpgradeVerificationError when the new wrap does not
 * reproduce the same VMK (or an item no longer opens); other errors come from key derivation.
 * Returns "not-needed" for a vault that is already on Argon2id.
 */
export async function prepareVaultKdfUpgrade(input: PrepareUpgradeInput): Promise<PrepareUpgradeResult> {
  const { vault, vaultId, passphrase, masterKeyBase64, sampleItem, options = {} } = input;
  if (!needsKdfUpgrade(vault.kdfAlgorithm)) return { status: "not-needed" };

  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const kdfSaltBase64 = bytesToBase64(saltBytes);

  const newBundle = await rewrapVaultMasterKeyForKdfUpgrade(
    masterKeyBase64,
    passphrase,
    vaultId,
    vault.currentKeyVersion,
    kdfSaltBase64,
    { kdf: DEFAULT_ARGON2ID_PARAMS, policy: options.policy }
  );

  // Cheap structural checks first.
  if (newBundle.kdfAlgorithm !== ARGON2ID_DEFAULT_ALGORITHM_ID) {
    throw new KdfUpgradeVerificationError("unexpected algorithm.");
  }
  if (newBundle.keyVersion !== vault.currentKeyVersion) {
    throw new KdfUpgradeVerificationError("key version changed.");
  }
  if (newBundle.kdfSaltBase64 === vault.kdfSaltBase64) {
    throw new KdfUpgradeVerificationError("the salt was not renewed.");
  }
  if (newBundle.wrappedMasterKeyCiphertext === vault.wrappedMasterKeyCiphertext) {
    throw new KdfUpgradeVerificationError("the wrap did not change.");
  }

  // The real check: open the new bundle exactly as the next unlock will, and compare the key.
  let recoveredBase64: string;
  try {
    recoveredBase64 = await unwrapVaultMasterKeyWithPassphrase(newBundle, passphrase, vaultId, options);
  } catch {
    throw new KdfUpgradeVerificationError("the new bundle does not open with the passphrase.");
  }
  const [expectedHash, recoveredHash] = await Promise.all([sha256Hex(masterKeyBase64), sha256Hex(recoveredBase64)]);
  if (expectedHash !== recoveredHash) {
    throw new KdfUpgradeVerificationError("the recovered key differs from the unlocked key.");
  }

  if (sampleItem) {
    try {
      await decryptVaultItemPayload({ bundle: sampleItem, vaultMasterKeyBase64: recoveredBase64 });
    } catch {
      throw new KdfUpgradeVerificationError("an existing item does not open with the recovered key.");
    }
  }

  return {
    status: "ready",
    newBundle,
    request: {
      action: "UPGRADE_VAULT_KDF",
      expected: {
        kdfAlgorithm: vault.kdfAlgorithm,
        wrappedMasterKeyCiphertext: vault.wrappedMasterKeyCiphertext,
        keyVersion: vault.currentKeyVersion,
      },
      next: {
        kdfAlgorithm: newBundle.kdfAlgorithm,
        kdfSaltBase64: newBundle.kdfSaltBase64,
        wrappedMasterKeyCiphertext: newBundle.wrappedMasterKeyCiphertext,
        wrappedMasterKeyIv: newBundle.wrappedMasterKeyIv,
      },
    },
  };
}

/** Result of sending the request. `ok` is the server accepting the swap. */
export interface UpgradeSendResult {
  ok: boolean;
}

export type UpgradeSkipReason =
  /** Deriving or wrapping failed (worker error, timeout). */
  | "derivation"
  /** The new bundle did not reproduce the same key. Nothing was sent. */
  | "verification"
  /** The request could not reach the server. */
  | "network"
  /** The server declined (someone else changed the vault, or it refused the request). */
  | "refused";

export type UpgradeOutcome =
  | { status: "upgraded"; newBundle: WrappedMasterKeyBundle }
  | { status: "not-needed" }
  | { status: "skipped"; reason: UpgradeSkipReason };

/**
 * Prepares, verifies and sends the upgrade. Never throws: every failure becomes a "skipped"
 * outcome and the caller carries on (the vault stays unlocked; the next unlock tries again).
 * `send` is only called after verification passed.
 */
export async function runVaultKdfUpgrade(
  input: PrepareUpgradeInput & { send: (request: UpgradeVaultKdfRequest) => Promise<UpgradeSendResult> }
): Promise<UpgradeOutcome> {
  let prepared: PrepareUpgradeResult;
  try {
    prepared = await prepareVaultKdfUpgrade(input);
  } catch (err) {
    return { status: "skipped", reason: err instanceof KdfUpgradeVerificationError ? "verification" : "derivation" };
  }
  if (prepared.status === "not-needed") return { status: "not-needed" };

  let result: UpgradeSendResult;
  try {
    result = await input.send(prepared.request);
  } catch {
    return { status: "skipped", reason: "network" };
  }
  return result.ok ? { status: "upgraded", newBundle: prepared.newBundle } : { status: "skipped", reason: "refused" };
}
