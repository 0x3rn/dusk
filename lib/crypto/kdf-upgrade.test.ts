// lib/crypto/kdf-upgrade.test.ts
// The automatic PBKDF2 -> Argon2id upgrade: re-wrap, verify, and the failure paths. Uses the real
// legacy vectors (PBKDF2-SHA256 600,000 iterations, an 8-character passphrase, a legacy recovery
// kit), so the test fails if an old vault could not be upgraded or the kit stopped working.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARGON2ID_DEFAULT_ALGORITHM_ID } from "./kdf";
import { LEGACY } from "./legacy-vectors.fixture";
import {
  KdfUpgradeVerificationError,
  needsKdfUpgrade,
  prepareVaultKdfUpgrade,
  runVaultKdfUpgrade,
  type UpgradeVaultKdfRequest,
  type VaultKdfState,
} from "./kdf-upgrade";
import { recoverVaultMasterKeyFromKit } from "./recovery-kit";
import {
  createAndWrapVaultMasterKey,
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  generateRandomKeyBase64,
  unwrapVaultMasterKeyWithPassphrase,
  type EncryptedItemBundle,
} from "./vault-crypto";

// Lets individual tests make one step misbehave while everything else stays real.
const overrides = vi.hoisted(() => ({
  unwrap: null as null | (() => Promise<string>),
  rewrap: null as null | (() => Promise<never>),
}));

vi.mock("./vault-crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vault-crypto")>();
  return {
    ...actual,
    unwrapVaultMasterKeyWithPassphrase: (...args: Parameters<typeof actual.unwrapVaultMasterKeyWithPassphrase>) =>
      overrides.unwrap ? overrides.unwrap() : actual.unwrapVaultMasterKeyWithPassphrase(...args),
    rewrapVaultMasterKeyForKdfUpgrade: (...args: Parameters<typeof actual.rewrapVaultMasterKeyForKdfUpgrade>) =>
      overrides.rewrap ? overrides.rewrap() : actual.rewrapVaultMasterKeyForKdfUpgrade(...args),
  };
});

const SERVER_VAULT_ID = "vault_cuid_for_items";

function legacyVaultState(): VaultKdfState {
  const b = LEGACY.vaultShort.bundle;
  return {
    currentKeyVersion: b.keyVersion,
    kdfAlgorithm: b.kdfAlgorithm,
    kdfSaltBase64: b.kdfSaltBase64,
    wrappedMasterKeyCiphertext: b.wrappedMasterKeyCiphertext,
    wrappedMasterKeyIv: b.wrappedMasterKeyIv,
  };
}

async function legacyItem(vmk = LEGACY.vaultMasterKeyBase64): Promise<EncryptedItemBundle> {
  const { bundle } = await encryptVaultItemPayload({
    payload: { title: "Bank", content: "pin 6789" },
    vaultMasterKeyBase64: vmk,
    vaultId: SERVER_VAULT_ID,
    itemId: "itm_1",
  });
  return bundle;
}

beforeEach(() => {
  overrides.unwrap = null;
  overrides.rewrap = null;
});

describe("needsKdfUpgrade", () => {
  it("is true for PBKDF2 vaults only", () => {
    expect(needsKdfUpgrade("PBKDF2-SHA256-600000")).toBe(true);
    expect(needsKdfUpgrade(ARGON2ID_DEFAULT_ALGORITHM_ID)).toBe(false);
  });

  it("is false for identifiers that would not even run (never upgraded from a hostile value)", () => {
    for (const bad of ["", "PBKDF2-SHA256-1", "SCRYPT-1", "PBKDF2-SHA256-600000+PASSPHRASE", "ARGON2ID-1-1-1"]) {
      expect(needsKdfUpgrade(bad)).toBe(false);
    }
  });
});

describe("prepareVaultKdfUpgrade with the real legacy vectors", () => {
  it("re-wraps the SAME key under Argon2id; items and the recovery kit are untouched and still work", async () => {
    const item = await legacyItem();
    const itemBefore = JSON.stringify(item);
    const recoveryBefore = JSON.stringify(LEGACY.recoveryNoPassphrase.artifact);

    const result = await prepareVaultKdfUpgrade({
      vault: legacyVaultState(),
      vaultId: LEGACY.vaultId,
      passphrase: LEGACY.vaultShort.passphrase, // 8 characters: below the new-passphrase minimum
      masterKeyBase64: LEGACY.vaultMasterKeyBase64,
      sampleItem: item,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("unreachable");

    // What the server will be asked to do.
    expect(result.request.action).toBe("UPGRADE_VAULT_KDF");
    expect(result.request.expected).toEqual({
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      wrappedMasterKeyCiphertext: LEGACY.vaultShort.bundle.wrappedMasterKeyCiphertext,
      keyVersion: 1,
    });
    expect(result.request.next.kdfAlgorithm).toBe(ARGON2ID_DEFAULT_ALGORITHM_ID);
    expect(result.request.next.kdfSaltBase64).not.toBe(LEGACY.vaultShort.bundle.kdfSaltBase64);
    expect(result.request.next.wrappedMasterKeyCiphertext).not.toBe(LEGACY.vaultShort.bundle.wrappedMasterKeyCiphertext);
    expect(Object.keys(result.request.next).sort()).toEqual(
      ["kdfAlgorithm", "kdfSaltBase64", "wrappedMasterKeyCiphertext", "wrappedMasterKeyIv"]
    );

    // The next unlock (with the new bundle) gives the identical key.
    const vmkAfter = await unwrapVaultMasterKeyWithPassphrase(result.newBundle, LEGACY.vaultShort.passphrase, LEGACY.vaultId);
    expect(vmkAfter).toBe(LEGACY.vaultMasterKeyBase64);

    // Items (encrypted under keys derived from the VMK) still open and were not modified.
    const opened = await decryptVaultItemPayload<{ title: string; content: string }>({ bundle: item, vaultMasterKeyBase64: vmkAfter });
    expect(opened.payload).toEqual({ title: "Bank", content: "pin 6789" });
    expect(JSON.stringify(item)).toBe(itemBefore);

    // PROOF the recovery kit still recovers after the upgrade: same artifact, same VMK.
    const recovered = await recoverVaultMasterKeyFromKit({
      serverArtifact: LEGACY.recoveryNoPassphrase.artifact,
      recoveryCode: LEGACY.recoveryNoPassphrase.recoveryCode,
    });
    expect(recovered).toBe(vmkAfter);
    expect(JSON.stringify(LEGACY.recoveryNoPassphrase.artifact)).toBe(recoveryBefore);
  });

  it("uses a fresh salt and IV every time", async () => {
    const input = {
      vault: legacyVaultState(),
      vaultId: LEGACY.vaultId,
      passphrase: LEGACY.vaultShort.passphrase,
      masterKeyBase64: LEGACY.vaultMasterKeyBase64,
    };
    const a = await prepareVaultKdfUpgrade(input);
    const b = await prepareVaultKdfUpgrade(input);
    if (a.status !== "ready" || b.status !== "ready") throw new Error("unreachable");
    expect(a.request.next.kdfSaltBase64).not.toBe(b.request.next.kdfSaltBase64);
    expect(a.request.next.wrappedMasterKeyIv).not.toBe(b.request.next.wrappedMasterKeyIv);
  });

  it("does nothing for a vault that is already on Argon2id", async () => {
    const { masterKeyBase64, wrappedBundle } = await createAndWrapVaultMasterKey("a long enough passphrase", LEGACY.vaultId);
    const send = vi.fn();
    const outcome = await runVaultKdfUpgrade({
      vault: { currentKeyVersion: 1, ...wrappedBundle },
      vaultId: LEGACY.vaultId,
      passphrase: "a long enough passphrase",
      masterKeyBase64,
      send,
    });
    expect(outcome).toEqual({ status: "not-needed" });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("runVaultKdfUpgrade: sending and failures (never throws, never sends unverified data)", () => {
  const base = () => ({
    vault: legacyVaultState(),
    vaultId: LEGACY.vaultId,
    passphrase: LEGACY.vaultShort.passphrase,
    masterKeyBase64: LEGACY.vaultMasterKeyBase64,
  });

  it("sends exactly one verified request and reports upgraded", async () => {
    const sent: UpgradeVaultKdfRequest[] = [];
    const outcome = await runVaultKdfUpgrade({
      ...base(),
      send: async (request) => {
        sent.push(request);
        return { ok: true };
      },
    });
    expect(outcome.status).toBe("upgraded");
    expect(sent).toHaveLength(1);
    expect(sent[0].next.kdfAlgorithm).toBe(ARGON2ID_DEFAULT_ALGORITHM_ID);
    // The request body holds no passphrase and no raw key.
    const text = JSON.stringify(sent[0]);
    expect(text).not.toContain(LEGACY.vaultShort.passphrase);
    expect(text).not.toContain(LEGACY.vaultMasterKeyBase64);
  });

  it("does not send when the recovered key differs from the unlocked key", async () => {
    overrides.unwrap = async () => generateRandomKeyBase64();
    const send = vi.fn();
    const outcome = await runVaultKdfUpgrade({ ...base(), send });
    expect(outcome).toEqual({ status: "skipped", reason: "verification" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when the new bundle cannot be opened", async () => {
    overrides.unwrap = async () => {
      throw new Error("cannot open");
    };
    const send = vi.fn();
    expect(await runVaultKdfUpgrade({ ...base(), send })).toEqual({ status: "skipped", reason: "verification" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when an existing item no longer opens with the recovered key", async () => {
    // The "unlocked" key is not the one the item was encrypted with.
    const wrongVmk = await generateRandomKeyBase64();
    const send = vi.fn();
    const outcome = await runVaultKdfUpgrade({
      ...base(),
      masterKeyBase64: wrongVmk,
      sampleItem: await legacyItem(),
      send,
    });
    expect(outcome).toEqual({ status: "skipped", reason: "verification" });
    expect(send).not.toHaveBeenCalled();
  });

  it("prepare throws the typed verification error (so callers can tell it from a derivation failure)", async () => {
    overrides.unwrap = async () => generateRandomKeyBase64();
    await expect(prepareVaultKdfUpgrade(base())).rejects.toBeInstanceOf(KdfUpgradeVerificationError);
  });

  it("skips quietly when key derivation fails", async () => {
    overrides.rewrap = async () => {
      throw new Error("worker crashed");
    };
    const send = vi.fn();
    expect(await runVaultKdfUpgrade({ ...base(), send })).toEqual({ status: "skipped", reason: "derivation" });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips quietly when the network fails", async () => {
    const outcome = await runVaultKdfUpgrade({
      ...base(),
      send: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(outcome).toEqual({ status: "skipped", reason: "network" });
  });

  it("skips quietly when the server refuses", async () => {
    expect(await runVaultKdfUpgrade({ ...base(), send: async () => ({ ok: false }) })).toEqual({
      status: "skipped",
      reason: "refused",
    });
  });
});
