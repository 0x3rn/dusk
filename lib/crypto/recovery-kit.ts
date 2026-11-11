// lib/crypto/recovery-kit.ts
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  CRYPTO_SCHEMA_VERSION,
  CryptoTamperOrAuthError,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  encodeAadContext,
  generateIvBytes,
  wrapVaultMasterKeyWithPassphrase,
  type CreateVaultOptions,
  type WrappedMasterKeyBundle,
} from "./vault-crypto";
import {
  DEFAULT_ARGON2ID_PARAMS,
  assertKdfParamsAcceptable,
  deriveKeyBytes,
  formatKdfAlgorithm,
  parseKdfAlgorithm,
  type KdfParams,
  type KdfPolicy,
} from "./kdf";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Server-stored recovery artifact. `kdfAlgorithm` names the real key derivation, e.g.
 * "ARGON2ID-19456-2-1" (kits made now) or "PBKDF2-SHA256-310000" (kits made before Argon2id),
 * with a "+PASSPHRASE" suffix when a kit passphrase was mixed in. See ./kdf.ts.
 */
export interface RecoveryServerArtifact {
  schemaVersion: number;
  keyVersion: number;
  vaultId: string;
  recoveryWrappedVmKBase64: string;
  recoveryWrappedVmKIv: string;
  kdfSaltBase64: string;
  kdfAlgorithm: string;
  fingerprintHex: string;
}

export interface UserPrintableRecoveryKit {
  kitVersion: number;
  createdAtIso: string;
  accountEmail: string;
  vaultId: string;
  keyVersion: number;
  fingerprintHex: string;
  recoveryCode: string; // CRITICAL SECRET: User stores offline; NEVER sent to server
  requiresPassphrase: boolean;
  warningNotice: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * Normalizes a user-entered Recovery Code (removes spaces/hyphens, uppercases,
 * and maps common visual typos O->0, I/L->1).
 */
export function normalizeRecoveryCode(input: string): string {
  if (!input || typeof input !== "string") {
    throw new CryptoTamperOrAuthError("Recovery code is required.");
  }
  const cleaned = input
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (!cleaned.startsWith("DUSK") || cleaned.length !== 36) {
    throw new CryptoTamperOrAuthError(
      "Invalid Dusk Recovery Code format. Expected DUSK followed by 32 characters."
    );
  }
  return cleaned;
}

/**
 * Computes a deterministic, browser-safe 16-character hex fingerprint of the normalized
 * Recovery Code (FNV-1a 64-bit dual-lane) synchronously, and also verified via Web Crypto AAD.
 */
export function computeRecoveryCodeFingerprint(recoveryCode: string): string {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const input = `dusk-recovery-fingerprint-v1|${normalized}`;

  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code ^ (i & 0xff);
    h2 = Math.imul(h2, 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${hex1}${hex2}`;
}

/**
 * Encodes 32 random symbols from a 32-letter alphabet (5 bits each, 160 bits of entropy) into a
 * human-friendly Recovery Code: `DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`.
 * 160 random bits cannot be guessed, so the code itself needs no slow key derivation; the slow,
 * memory-hard derivation protects the OPTIONAL human-chosen kit passphrase that can be mixed in.
 */
export function generateRecoveryCode(): {
  recoveryCode: string;
  rawEntropyBytes: Uint8Array;
  fingerprintHex: string;
} {
  const rawEntropyBytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(rawEntropyBytes);

  let chars = "";
  for (let i = 0; i < rawEntropyBytes.length; i++) {
    chars += CROCKFORD_ALPHABET[rawEntropyBytes[i] % 32];
  }

  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 4) {
    groups.push(chars.slice(i, i + 4));
  }

  const recoveryCode = `DUSK-${groups.join("-")}`;
  const fingerprintHex = computeRecoveryCodeFingerprint(recoveryCode);

  return {
    recoveryCode,
    rawEntropyBytes,
    fingerprintHex,
  };
}

/**
 * Derives the 256-bit AES-GCM Recovery Wrapping Key from the Recovery Code, salt, and optional
 * kit passphrase. The stored `kdfAlgorithm` picks the algorithm (Argon2id for kits made now,
 * PBKDF2-SHA256 for older kits); it is validated first, so a hostile identifier never runs.
 */
async function deriveRecoveryWrappingKey(params: {
  recoveryCode: string;
  kdfSaltBase64: string;
  kdfAlgorithm: string;
  recoveryPassphrase?: string;
  keyVersion: number;
  policy?: KdfPolicy;
}): Promise<CryptoKey> {
  const { params: kdfParams } = parseKdfAlgorithm(params.kdfAlgorithm, "recovery-kit", params.policy);
  const normalizedCode = normalizeRecoveryCode(params.recoveryCode);
  const saltBytes = base64ToBytes(params.kdfSaltBase64);
  if (saltBytes.byteLength < 16) {
    throw new CryptoTamperOrAuthError("Invalid recovery KDF salt.");
  }

  const normalizedPassphrase = (params.recoveryPassphrase ?? "").normalize("NFKC");
  const combinedInputBytes = new TextEncoder().encode(
    `${normalizedCode}|pass:${normalizedPassphrase}|kv:${params.keyVersion}`
  );

  const keyBytes = await deriveKeyBytes(kdfParams, combinedInputBytes, saltBytes);
  try {
    return await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(keyBytes),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } finally {
    keyBytes.fill(0);
    combinedInputBytes.fill(0);
  }
}

/**
 * Creates a complete Recovery Kit for a user's Vault Master Key (VMK).
 */
export async function createRecoveryKitForVault(params: {
  vaultMasterKeyBase64: string;
  vaultId: string;
  accountEmail: string;
  keyVersion: number;
  recoveryPassphrase?: string;
  /** Key derivation for the new kit. Defaults to Argon2id (19 MiB, 2 passes). */
  kdf?: KdfParams;
  /** Test-only relaxation of the PBKDF2 floor. */
  policy?: KdfPolicy;
}): Promise<{
  clientKit: UserPrintableRecoveryKit;
  serverArtifact: RecoveryServerArtifact;
}> {
  const rawVmk = base64ToBytes(params.vaultMasterKeyBase64);
  if (rawVmk.byteLength !== 32) {
    throw new Error("Vault Master Key must be exactly 32 bytes (256 bits).");
  }

  const kdf = params.kdf ?? DEFAULT_ARGON2ID_PARAMS;
  assertKdfParamsAcceptable(kdf, "recovery-kit", params.policy);
  const hasPassphrase = Boolean(
    params.recoveryPassphrase && params.recoveryPassphrase.length > 0
  );
  const kdfAlgorithm = formatKdfAlgorithm(kdf, { kitPassphrase: hasPassphrase });

  const { recoveryCode, fingerprintHex } = generateRecoveryCode();
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const kdfSaltBase64 = bytesToBase64(saltBytes);
  const iv = generateIvBytes();

  const wrappingKey = await deriveRecoveryWrappingKey({
    recoveryCode,
    kdfSaltBase64,
    kdfAlgorithm,
    recoveryPassphrase: params.recoveryPassphrase,
    keyVersion: params.keyVersion,
    policy: params.policy,
  });

  const aadBytes = encodeAadContext({
    vaultId: params.vaultId,
    resourceId: fingerprintHex,
    resourceType: "RECOVERY_KIT",
    keyVersion: params.keyVersion,
  });

  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aadBytes),
      tagLength: AES_GCM_TAG_BITS,
    },
    wrappingKey,
    toArrayBuffer(rawVmk)
  );

  return {
    clientKit: {
      kitVersion: CRYPTO_SCHEMA_VERSION,
      createdAtIso: new Date().toISOString(),
      accountEmail: params.accountEmail,
      vaultId: params.vaultId,
      keyVersion: params.keyVersion,
      fingerprintHex,
      recoveryCode,
      requiresPassphrase: hasPassphrase,
      warningNotice:
        "ZERO-KNOWLEDGE WARNING: Dusk servers never store this Recovery Code and cannot recover your vault if both your Master Passphrase and this Recovery Kit are lost.",
    },
    serverArtifact: {
      schemaVersion: CRYPTO_SCHEMA_VERSION,
      keyVersion: params.keyVersion,
      vaultId: params.vaultId,
      recoveryWrappedVmKBase64: bytesToBase64(new Uint8Array(encryptedBuf)),
      recoveryWrappedVmKIv: bytesToBase64(iv),
      kdfSaltBase64,
      kdfAlgorithm,
      fingerprintHex,
    },
  };
}

/**
 * Unwraps the Vault Master Key (VMK) using the user's offline Recovery Code
 * (and optional recovery passphrase) against the server-stored `RecoveryServerArtifact`.
 */
export async function recoverVaultMasterKeyFromKit(params: {
  serverArtifact: RecoveryServerArtifact;
  recoveryCode: string;
  recoveryPassphrase?: string;
  /** Test-only relaxation of the PBKDF2 floor. */
  policy?: KdfPolicy;
}): Promise<string> {
  const { serverArtifact, recoveryCode, recoveryPassphrase, policy } = params;

  // Fail early, with a useful message, on an identifier we will not run or a missing kit passphrase.
  const { usesKitPassphrase } = parseKdfAlgorithm(serverArtifact.kdfAlgorithm, "recovery-kit", policy);
  if (usesKitPassphrase && !recoveryPassphrase) {
    throw new CryptoTamperOrAuthError("This recovery kit also needs the kit passphrase it was created with.");
  }

  const providedFingerprint = computeRecoveryCodeFingerprint(recoveryCode);
  if (providedFingerprint !== serverArtifact.fingerprintHex) {
    throw new CryptoTamperOrAuthError(
      "Recovery Code fingerprint does not match the active Recovery Kit artifact."
    );
  }

  const iv = base64ToBytes(serverArtifact.recoveryWrappedVmKIv);
  const ciphertext = base64ToBytes(serverArtifact.recoveryWrappedVmKBase64);
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new CryptoTamperOrAuthError("Invalid IV on recovery artifact.");
  }

  try {
    const wrappingKey = await deriveRecoveryWrappingKey({
      recoveryCode,
      kdfSaltBase64: serverArtifact.kdfSaltBase64,
      kdfAlgorithm: serverArtifact.kdfAlgorithm,
      recoveryPassphrase,
      keyVersion: serverArtifact.keyVersion,
      policy,
    });

    const aadBytes = encodeAadContext({
      vaultId: serverArtifact.vaultId,
      resourceId: serverArtifact.fingerprintHex,
      resourceType: "RECOVERY_KIT",
      keyVersion: serverArtifact.keyVersion,
    });

    const decryptedBuf = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aadBytes),
        tagLength: AES_GCM_TAG_BITS,
      },
      wrappingKey,
      toArrayBuffer(ciphertext)
    );

    return bytesToBase64(new Uint8Array(decryptedBuf));
  } catch (err) {
    if (err instanceof CryptoTamperOrAuthError) throw err;
    throw new CryptoTamperOrAuthError(
      "Failed to unwrap Vault Master Key from Recovery Kit: invalid passphrase or tampered artifact."
    );
  }
}

/**
 * Re-enrolls a recovered Vault Master Key under a brand new Master Passphrase
 * so the user can regain normal passphrase access on a new device without losing vault contents.
 */
export async function rewrapRecoveredMasterKeyWithNewPassphrase(params: {
  serverArtifact: RecoveryServerArtifact;
  recoveryCode: string;
  recoveryPassphrase?: string;
  newMasterPassphrase: string;
  /** Key derivation for the new passphrase wrapping. Defaults to Argon2id. */
  newPassphraseOptions?: CreateVaultOptions;
  /** Test-only relaxation of the PBKDF2 floor when reading the artifact. */
  policy?: KdfPolicy;
}): Promise<{
  recoveredMasterKeyBase64: string;
  newWrappedMasterKeyBundle: WrappedMasterKeyBundle;
}> {
  const recoveredMasterKeyBase64 = await recoverVaultMasterKeyFromKit({
    serverArtifact: params.serverArtifact,
    recoveryCode: params.recoveryCode,
    recoveryPassphrase: params.recoveryPassphrase,
    policy: params.policy,
  });

  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const newSaltBase64 = bytesToBase64(saltBytes);

  const newWrappedMasterKeyBundle = await wrapVaultMasterKeyWithPassphrase(
    recoveredMasterKeyBase64,
    params.newMasterPassphrase,
    params.serverArtifact.vaultId,
    params.serverArtifact.keyVersion,
    newSaltBase64,
    params.newPassphraseOptions
  );

  return {
    recoveredMasterKeyBase64,
    newWrappedMasterKeyBundle,
  };
}

export { bytesToHex };