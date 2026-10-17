// lib/crypto/recovery-kit.ts
import crypto from "node:crypto";
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  CRYPTO_SCHEMA_VERSION,
  CryptoTamperOrAuthError,
  base64ToBytes,
  bytesToBase64,
  encodeAadContext,
  generateIvBytes,
  wrapVaultMasterKeyWithPassphrase,
  type WrappedMasterKeyBundle,
} from "./vault-crypto";

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

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
 * Encodes 32 random bytes (256 bits) into a human-friendly Recovery Code:
 * `DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
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
 * Computes a public 16-character hex fingerprint of the normalized Recovery Code
 * using domain-separated SHA-256 so the UI can show which Recovery Kit is active
 * without exposing the recovery secret.
 */
export function computeRecoveryCodeFingerprint(recoveryCode: string): string {
  const normalized = normalizeRecoveryCode(recoveryCode);
  const digest = crypto
    .createHash("sha256")
    .update(`dusk-recovery-fingerprint-v1|${normalized}`, "utf8")
    .digest("hex");
  return digest.slice(0, 16);
}

/**
 * Derives the 256-bit AES-GCM Recovery Wrapping Key from the Recovery Code,
 * salt, and optional recovery passphrase using memory-hard scrypt.
 */
async function deriveRecoveryWrappingKey(params: {
  recoveryCode: string;
  kdfSaltBase64: string;
  recoveryPassphrase?: string;
  keyVersion: number;
}): Promise<CryptoKey> {
  const normalizedCode = normalizeRecoveryCode(params.recoveryCode);
  const saltBytes = base64ToBytes(params.kdfSaltBase64);
  if (saltBytes.byteLength < 16) {
    throw new CryptoTamperOrAuthError("Invalid recovery KDF salt.");
  }

  const normalizedPassphrase = (params.recoveryPassphrase ?? "").normalize("NFKC");
  const combinedInput = `${normalizedCode}|pass:${normalizedPassphrase}|kv:${params.keyVersion}`;

  const derivedBytes = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(
      combinedInput,
      Buffer.from(saltBytes),
      32,
      { N: 16384, r: 8, p: 1 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });

  return globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new Uint8Array(derivedBytes)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Creates a complete Recovery Kit for a user's Vault Master Key (VMK).
 * Returns:
 * - `clientKit`: The printable/downloadable kit containing the secret `recoveryCode` (NEVER sent to server).
 * - `serverArtifact`: The wrapped VMK and metadata safe to store in Neon PostgreSQL (`RecoveryArtifact`).
 */
export async function createRecoveryKitForVault(params: {
  vaultMasterKeyBase64: string;
  vaultId: string;
  accountEmail: string;
  keyVersion: number;
  recoveryPassphrase?: string;
}): Promise<{
  clientKit: UserPrintableRecoveryKit;
  serverArtifact: RecoveryServerArtifact;
}> {
  const rawVmk = base64ToBytes(params.vaultMasterKeyBase64);
  if (rawVmk.byteLength !== 32) {
    throw new Error("Vault Master Key must be exactly 32 bytes (256 bits).");
  }

  const { recoveryCode, fingerprintHex } = generateRecoveryCode();
  const saltBytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(saltBytes);
  const kdfSaltBase64 = bytesToBase64(saltBytes);
  const iv = generateIvBytes();

  const wrappingKey = await deriveRecoveryWrappingKey({
    recoveryCode,
    kdfSaltBase64,
    recoveryPassphrase: params.recoveryPassphrase,
    keyVersion: params.keyVersion,
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

  const hasPassphrase = Boolean(
    params.recoveryPassphrase && params.recoveryPassphrase.length > 0
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
      kdfAlgorithm: hasPassphrase
        ? "SCRYPT-16384-8-1+PASSPHRASE"
        : "SCRYPT-16384-8-1",
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
}): Promise<string> {
  const { serverArtifact, recoveryCode, recoveryPassphrase } = params;

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
      recoveryPassphrase,
      keyVersion: serverArtifact.keyVersion,
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
  pbkdf2Iterations?: number;
}): Promise<{
  recoveredMasterKeyBase64: string;
  newWrappedMasterKeyBundle: WrappedMasterKeyBundle;
}> {
  const recoveredMasterKeyBase64 = await recoverVaultMasterKeyFromKit({
    serverArtifact: params.serverArtifact,
    recoveryCode: params.recoveryCode,
    recoveryPassphrase: params.recoveryPassphrase,
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
    params.pbkdf2Iterations
  );

  return {
    recoveredMasterKeyBase64,
    newWrappedMasterKeyBundle,
  };
}