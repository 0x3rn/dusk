// lib/crypto/kdf-server-validation.test.ts
// The server also refuses unknown or weak key-derivation identifiers when a vault or recovery
// kit is stored, so a buggy or hostile client cannot plant settings that other devices would
// later be told to run.
import { describe, expect, it } from "vitest";
import { parseDashboardAction } from "../api/dashboard-actions";
import { InitializeVaultInputSchema } from "../services/foundation-service";
import { StoreRecoveryArtifactInputSchema } from "../services/recovery-service";
import { isAcceptableKdfAlgorithm } from "./kdf";

const artifact = (kdfAlgorithm: string) => ({
  keyVersion: 1,
  recoveryWrappedVmKBase64: "eY2pUtYAWH2ompxZYrTnv+dfVyNCgeoLZAukXQQtvD7nbTx7+vk4CkWoNySA5puJ",
  recoveryWrappedVmKIv: "zfXrmc5HkOr4nOYp",
  kdfSaltBase64: "Sj1Lsq6urjVyx8Vv78r/9g==",
  kdfAlgorithm,
  fingerprintHex: "39766ff115ab7aa6",
});

const initVault = (kdfAlgorithm: string) => ({
  action: "INIT_VAULT",
  vaultBundle: { wrappedMasterKeyCiphertext: "x", wrappedMasterKeyIv: "y", kdfSaltBase64: "z", kdfAlgorithm },
  recoveryServerArtifact: artifact(kdfAlgorithm),
});

describe("server-side KDF identifier validation", () => {
  it("isAcceptableKdfAlgorithm mirrors the parser", () => {
    expect(isAcceptableKdfAlgorithm("ARGON2ID-19456-2-1", "vault-passphrase")).toBe(true);
    expect(isAcceptableKdfAlgorithm("PBKDF2-SHA256-600000", "vault-passphrase")).toBe(true);
    expect(isAcceptableKdfAlgorithm("PBKDF2-SHA256-310000+PASSPHRASE", "recovery-kit")).toBe(true);
    expect(isAcceptableKdfAlgorithm("ARGON2ID-4194304-2-1", "vault-passphrase")).toBe(false);
    expect(isAcceptableKdfAlgorithm("md5", "recovery-kit")).toBe(false);
  });

  it("INIT_VAULT accepts the identifiers Dusk writes for recovery kits", () => {
    for (const id of ["ARGON2ID-19456-2-1", "ARGON2ID-19456-2-1+PASSPHRASE", "PBKDF2-SHA256-310000", "PBKDF2-SHA256-310000+PASSPHRASE"]) {
      const parsed = parseDashboardAction(initVault(id));
      expect(parsed.action).toBe("INIT_VAULT");
    }
  });

  it("INIT_VAULT refuses a weak, absurd or unknown recovery-kit identifier", () => {
    for (const id of ["PBKDF2-SHA256-1", "ARGON2ID-4194304-2-1", "ARGON2ID-8192-2-1", "scrypt", "PBKDF2"]) {
      expect(() => parseDashboardAction(initVault(id)), id).toThrow(/Unsupported key settings/);
    }
  });

  it("initialising a vault accepts new and legacy identifiers, defaults to the legacy label, and refuses others", () => {
    const base = { wrappedMasterKeyCiphertext: "a".repeat(32), wrappedMasterKeyIv: "b".repeat(16), kdfSaltBase64: "c".repeat(24) };
    expect(InitializeVaultInputSchema.parse({ ...base, kdfAlgorithm: "ARGON2ID-19456-2-1" }).kdfAlgorithm).toBe("ARGON2ID-19456-2-1");
    expect(InitializeVaultInputSchema.parse({ ...base, kdfAlgorithm: "PBKDF2-SHA256-600000" }).kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    expect(InitializeVaultInputSchema.parse(base).kdfAlgorithm).toBe("PBKDF2-SHA256-600000");
    for (const id of ["PBKDF2-SHA256-1000", "ARGON2ID-4194304-2-1", "x"]) {
      expect(InitializeVaultInputSchema.safeParse({ ...base, kdfAlgorithm: id }).success, id).toBe(false);
    }
  });

  it("storing a rotated recovery kit validates the identifier too", () => {
    const base = {
      ...artifact("ARGON2ID-19456-2-1"),
      recoveryWrappedVmKBase64: "a".repeat(32),
      recoveryWrappedVmKIv: "b".repeat(16),
      kdfSaltBase64: "c".repeat(24),
      fingerprintHex: "0123456789abcdef",
      confirmIrreversibleRotation: true,
    };
    expect(StoreRecoveryArtifactInputSchema.safeParse(base).success).toBe(true);
    expect(StoreRecoveryArtifactInputSchema.safeParse({ ...base, kdfAlgorithm: "PBKDF2-SHA256-5" }).success).toBe(false);
  });
});
