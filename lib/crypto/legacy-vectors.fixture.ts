// lib/crypto/legacy-vectors.fixture.ts
// Test data only (imported by unit tests and the browser tests, never by the app).
import type { RecoveryServerArtifact } from "./recovery-kit";
import type { WrappedMasterKeyBundle } from "./vault-crypto";

/**
 * Fixed vectors produced by the code as it was BEFORE Argon2id (commit 290f579: PBKDF2-SHA256
 * with 600,000 iterations for vaults, 310,000 for recovery kits, no passphrase length rule at
 * unlock). They are data, not regenerated here, so this test fails if the unlock path ever
 * stops opening an existing vault.
 */
export const LEGACY = {
  vaultMasterKeyBase64: "oKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr8=",
  vaultId: "vlt_primary",
  vaultShort: {
    // 8 characters: the old minimum. Must still unlock although new vaults now need 12.
    passphrase: "oldpass8",
    bundle: {
      schemaVersion: 1,
      keyVersion: 1,
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      kdfSaltBase64: "EBESExQVFhcYGRobHB0eHw==",
      wrappedMasterKeyCiphertext: "VlSzOBtCn0wquzeUAFjZ5BKEhCabIaDjxy6zJrJ76sJZkvHeDn18Jlu/Sa/bAPES",
      wrappedMasterKeyIv: "posq9SWSNPL5C9BH",
    } satisfies WrappedMasterKeyBundle,
  },
  vaultLong: {
    passphrase: "an older, longer passphrase",
    bundle: {
      schemaVersion: 1,
      keyVersion: 1,
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      kdfSaltBase64: "EBESExQVFhcYGRobHB0eHw==",
      wrappedMasterKeyCiphertext: "XaHLst6GeBo1igTqAMB89/qjcT/bi77n7/3dpTNJXi9x7/iM9J0SjQaZrLuGMjVg",
      wrappedMasterKeyIv: "MlMqLlRHQ60XJH8H",
    } satisfies WrappedMasterKeyBundle,
  },
  recoveryNoPassphrase: {
    recoveryCode: "DUSK-PR8K-EQ6R-R0HX-A1C0-A1A8-A59A-KQ2D-44QW",
    artifact: {
      schemaVersion: 1,
      keyVersion: 1,
      vaultId: "vlt_primary",
      recoveryWrappedVmKBase64: "eY2pUtYAWH2ompxZYrTnv+dfVyNCgeoLZAukXQQtvD7nbTx7+vk4CkWoNySA5puJ",
      recoveryWrappedVmKIv: "zfXrmc5HkOr4nOYp",
      kdfSaltBase64: "Sj1Lsq6urjVyx8Vv78r/9g==",
      kdfAlgorithm: "PBKDF2-SHA256-310000",
      fingerprintHex: "39766ff115ab7aa6",
    } satisfies RecoveryServerArtifact,
  },
  recoveryWithPassphrase: {
    recoveryCode: "DUSK-83B1-EFPN-25Z4-XCDY-Y2BN-4B9F-GZE1-ZRH3",
    recoveryPassphrase: "kit passphrase",
    artifact: {
      schemaVersion: 1,
      keyVersion: 1,
      vaultId: "vlt_primary",
      recoveryWrappedVmKBase64: "lmpcluu1ZvzPxSt9pBDy4vnrDilA4qFUJ9wbFm1o8yGSqb131xYGYOuE70F1ECA6",
      recoveryWrappedVmKIv: "zWKJoqAOLP2k+fkq",
      kdfSaltBase64: "XJQcnEX0nW46Zee+WbBMRg==",
      kdfAlgorithm: "PBKDF2-SHA256-310000+PASSPHRASE",
      fingerprintHex: "21fc614e03607199",
    } satisfies RecoveryServerArtifact,
  },
} as const;
