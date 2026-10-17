// lib/crypto/vault-crypto.ts

/**
 * THE-98: Zero-Knowledge Client-Side Vault Encryption & Key Hierarchy
 *
 * Uses the standard W3C Web Crypto API (`globalThis.crypto.subtle`) so the exact
 * same cryptographic implementation runs in modern browsers and Node.js 20+ tests.
 *
 * Key Hierarchy:
 *   User Master Passphrase + 16-byte random Salt
 *     └── PBKDF2-SHA256 (600,000 iterations) -> Passphrase Key Encryption Key (KEK)
 *           └── Wraps/Unwraps 256-bit Vault Master Key (VMK)
 *                 ├── HKDF-SHA256 ("dusk-v1-item-kek") -> Wraps per-item 256-bit Item Keys (IEK)
 *                 ├── HKDF-SHA256 ("dusk-v1-file-kek") -> Wraps per-file 256-bit File Keys (FEK)
 *                 └── HKDF-SHA256 ("dusk-v1-folder-key") -> Encrypts folder names
 */

export const CRYPTO_SCHEMA_VERSION = 1;
export const AES_GCM_IV_BYTES = 12; // 96-bit nonce per NIST SP 800-38D
export const AES_KEY_BITS = 256;
export const AES_GCM_TAG_BITS = 128;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export type ResourceType =
  | "VAULT_ITEM"
  | "VAULT_FILE"
  | "VAULT_FOLDER"
  | "RECOVERY_KIT"
  | "RELEASE_PACKAGE";

export interface AadContext {
  vaultId: string;
  resourceId: string;
  resourceType: ResourceType;
  keyVersion: number;
}

export interface WrappedMasterKeyBundle {
  schemaVersion: number;
  keyVersion: number;
  kdfAlgorithm: string;
  kdfIterations: number;
  kdfSaltBase64: string;
  wrappedMasterKeyCiphertext: string;
  wrappedMasterKeyIv: string;
}

export interface EncryptedItemBundle {
  schemaVersion: number;
  keyVersion: number;
  ciphertextBase64: string;
  ivBase64: string;
  wrappedItemKeyBase64: string;
  wrappedItemKeyIvBase64: string;
  aadContext: AadContext;
}

export interface EncryptedFileBundle {
  schemaVersion: number;
  keyVersion: number;
  encryptedBlob: Uint8Array;
  blobIvBase64: string;
  ciphertextSha256Hex: string;
  encryptedMetaBase64: string;
  metaIvBase64: string;
  wrappedFileKeyBase64: string;
  wrappedFileKeyIvBase64: string;
  aadContext: AadContext;
}

export class CryptoTamperOrAuthError extends Error {
  public readonly code = "CRYPTO_AUTH_FAILED";
  constructor(
    message = "Cryptographic authentication failed: ciphertext, nonce, key, or AAD context was tampered with."
  ) {
    super(message);
    this.name = "CryptoTamperOrAuthError";
  }
}

function getWebCrypto(): Crypto {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("Web Crypto API is not available in this environment.");
  }
  return globalThis.crypto;
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (!base64 || base64.trim().length === 0) {
    throw new CryptoTamperOrAuthError("Invalid empty Base64 input.");
  }
  try {
    if (typeof Buffer !== "undefined") {
      const buf = Buffer.from(base64, "base64");
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new CryptoTamperOrAuthError("Malformed Base64 input.");
  }
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * Canonicalizes AAD context into a deterministic UTF-8 byte array
 * so AES-GCM authenticates the exact vaultId, resourceId, resourceType, and keyVersion.
 */
export function encodeAadContext(aad: AadContext): Uint8Array {
  const canonical = `dusk-aad-v1|${aad.vaultId}|${aad.resourceType}|${aad.resourceId}|kv:${aad.keyVersion}`;
  return new TextEncoder().encode(canonical);
}

/**
 * Generates a fresh 256-bit (32-byte) key and returns it as Base64.
 */
export async function generateRandomKeyBase64(): Promise<string> {
  const webCrypto = getWebCrypto();
  const key = await webCrypto.subtle.generateKey(
    { name: "AES-GCM", length: AES_KEY_BITS },
    true,
    ["encrypt", "decrypt"]
  );
  const raw = await webCrypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}

/**
 * Generates a fresh 96-bit (12-byte) IV/nonce for AES-GCM.
 */
export function generateIvBytes(): Uint8Array {
  const iv = new Uint8Array(AES_GCM_IV_BYTES);
  getWebCrypto().getRandomValues(iv);
  return iv;
}

/**
 * Derives a domain-separated 256-bit AES-GCM subkey from a parent 256-bit key using HKDF-SHA256.
 */
export async function deriveHkdfSubkey(
  parentKeyBase64: string,
  purposeInfo: string,
  keyVersion: number
): Promise<CryptoKey> {
  const webCrypto = getWebCrypto();
  const rawParent = base64ToBytes(parentKeyBase64);
  if (rawParent.byteLength !== 32) {
    throw new CryptoTamperOrAuthError("Parent key must be exactly 32 bytes (256 bits).");
  }

  const hkdfBaseKey = await webCrypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawParent),
    "HKDF",
    false,
    ["deriveKey"]
  );

  const infoBytes = new TextEncoder().encode(`${purposeInfo}|kv:${keyVersion}`);
  const saltBytes = new TextEncoder().encode("dusk-hkdf-salt-v1");

  return webCrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(saltBytes),
      info: toArrayBuffer(infoBytes),
    },
    hkdfBaseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) from a user's Master Passphrase + 16-byte salt
 * using PBKDF2-HMAC-SHA256.
 */
export async function derivePassphraseKek(
  passphrase: string,
  saltBase64: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error("Master passphrase must be at least 8 characters.");
  }
  const saltBytes = base64ToBytes(saltBase64);
  if (saltBytes.byteLength < 16) {
    throw new Error("KDF salt must be at least 16 bytes.");
  }

  const webCrypto = getWebCrypto();
  const normalizedPassphrase = new TextEncoder().encode(passphrase.normalize("NFKC"));

  const baseKey = await webCrypto.subtle.importKey(
    "raw",
    toArrayBuffer(normalizedPassphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return webCrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(saltBytes),
      iterations,
    },
    baseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Creates a new Vault Master Key (VMK) and wraps it under the user's passphrase-derived KEK.
 * Returns both the client-only `masterKeyBase64` and the server-safe `wrappedBundle`.
 */
export async function createAndWrapVaultMasterKey(
  passphrase: string,
  vaultId: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<{
  masterKeyBase64: string;
  wrappedBundle: WrappedMasterKeyBundle;
}> {
  const webCrypto = getWebCrypto();
  const masterKeyBase64 = await generateRandomKeyBase64();
  const saltBytes = new Uint8Array(16);
  webCrypto.getRandomValues(saltBytes);
  const kdfSaltBase64 = bytesToBase64(saltBytes);

  const wrappedBundle = await wrapVaultMasterKeyWithPassphrase(
    masterKeyBase64,
    passphrase,
    vaultId,
    1,
    kdfSaltBase64,
    iterations
  );

  return { masterKeyBase64, wrappedBundle };
}

export async function wrapVaultMasterKeyWithPassphrase(
  masterKeyBase64: string,
  passphrase: string,
  vaultId: string,
  keyVersion: number,
  kdfSaltBase64: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS
): Promise<WrappedMasterKeyBundle> {
  const webCrypto = getWebCrypto();
  const kek = await derivePassphraseKek(passphrase, kdfSaltBase64, iterations);
  const rawVmk = base64ToBytes(masterKeyBase64);
  if (rawVmk.byteLength !== 32) {
    throw new Error("Vault Master Key must be 32 bytes.");
  }

  const iv = generateIvBytes();
  const aad = encodeAadContext({
    vaultId,
    resourceId: "vmk",
    resourceType: "VAULT_ITEM",
    keyVersion,
  });

  const encrypted = await webCrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_GCM_TAG_BITS,
    },
    kek,
    toArrayBuffer(rawVmk)
  );

  return {
    schemaVersion: CRYPTO_SCHEMA_VERSION,
    keyVersion,
    kdfAlgorithm: `PBKDF2-SHA256-${iterations}`,
    kdfIterations: iterations,
    kdfSaltBase64,
    wrappedMasterKeyCiphertext: bytesToBase64(new Uint8Array(encrypted)),
    wrappedMasterKeyIv: bytesToBase64(iv),
  };
}

/**
 * Unwraps the Vault Master Key (VMK) on the client using the user's passphrase.
 */
export async function unwrapVaultMasterKeyWithPassphrase(
  bundle: WrappedMasterKeyBundle,
  passphrase: string,
  vaultId: string
): Promise<string> {
  try {
    const webCrypto = getWebCrypto();
    const kek = await derivePassphraseKek(
      passphrase,
      bundle.kdfSaltBase64,
      bundle.kdfIterations
    );
    const iv = base64ToBytes(bundle.wrappedMasterKeyIv);
    const ciphertext = base64ToBytes(bundle.wrappedMasterKeyCiphertext);
    if (iv.byteLength !== AES_GCM_IV_BYTES) {
      throw new CryptoTamperOrAuthError("Invalid IV length on wrapped VMK.");
    }

    const aad = encodeAadContext({
      vaultId,
      resourceId: "vmk",
      resourceType: "VAULT_ITEM",
      keyVersion: bundle.keyVersion,
    });

    const decrypted = await webCrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
        tagLength: AES_GCM_TAG_BITS,
      },
      kek,
      toArrayBuffer(ciphertext)
    );

    return bytesToBase64(new Uint8Array(decrypted));
  } catch (err) {
    if (err instanceof CryptoTamperOrAuthError) throw err;
    throw new CryptoTamperOrAuthError("Failed to unlock Vault Master Key: wrong passphrase or tampered bundle.");
  }
}

/**
 * Low-level deterministic AES-256-GCM encrypt with explicit key, IV, and AAD.
 * Used both by high-level helpers and by deterministic test vectors (THE-98).
 */
export async function aesGcmEncryptRaw(params: {
  plaintextBytes: Uint8Array;
  keyBase64: string;
  ivBytes: Uint8Array;
  aadContext: AadContext;
}): Promise<{ ciphertextBase64: string; ivBase64: string }> {
  if (params.ivBytes.byteLength !== AES_GCM_IV_BYTES) {
    throw new Error("AES-GCM IV must be exactly 12 bytes (96 bits).");
  }
  const rawKey = base64ToBytes(params.keyBase64);
  if (rawKey.byteLength !== 32) {
    throw new Error("AES-256-GCM key must be exactly 32 bytes (256 bits).");
  }

  const webCrypto = getWebCrypto();
  const cryptoKey = await webCrypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const aadBytes = encodeAadContext(params.aadContext);
  const encryptedBuffer = await webCrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(params.ivBytes),
      additionalData: toArrayBuffer(aadBytes),
      tagLength: AES_GCM_TAG_BITS,
    },
    cryptoKey,
    toArrayBuffer(params.plaintextBytes)
  );

  return {
    ciphertextBase64: bytesToBase64(new Uint8Array(encryptedBuffer)),
    ivBase64: bytesToBase64(params.ivBytes),
  };
}

/**
 * Low-level AES-256-GCM decrypt with explicit key, IV, and AAD.
 * Throws CryptoTamperOrAuthError on any authentication tag mismatch.
 */
export async function aesGcmDecryptRaw(params: {
  ciphertextBase64: string;
  ivBase64: string;
  keyBase64: string;
  aadContext: AadContext;
}): Promise<Uint8Array> {
  const ivBytes = base64ToBytes(params.ivBase64);
  const ciphertextBytes = base64ToBytes(params.ciphertextBase64);
  const rawKey = base64ToBytes(params.keyBase64);

  if (ivBytes.byteLength !== AES_GCM_IV_BYTES) {
    throw new CryptoTamperOrAuthError("AES-GCM IV must be exactly 12 bytes.");
  }
  if (rawKey.byteLength !== 32) {
    throw new CryptoTamperOrAuthError("AES-256-GCM key must be exactly 32 bytes.");
  }
  if (ciphertextBytes.byteLength < 16) {
    throw new CryptoTamperOrAuthError("Ciphertext is shorter than the 16-byte GCM authentication tag.");
  }

  try {
    const webCrypto = getWebCrypto();
    const cryptoKey = await webCrypto.subtle.importKey(
      "raw",
      toArrayBuffer(rawKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );

    const aadBytes = encodeAadContext(params.aadContext);
    const decryptedBuffer = await webCrypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(ivBytes),
        additionalData: toArrayBuffer(aadBytes),
        tagLength: AES_GCM_TAG_BITS,
      },
      cryptoKey,
      toArrayBuffer(ciphertextBytes)
    );

    return new Uint8Array(decryptedBuffer);
  } catch {
    throw new CryptoTamperOrAuthError();
  }
}

/**
 * Encrypts a structured Vault Item payload using a fresh per-item 256-bit Item Encryption Key (IEK)
 * and wraps that IEK under the Vault Master Key's HKDF item-wrapping subkey.
 */
export async function encryptVaultItemPayload<T>(params: {
  payload: T;
  vaultMasterKeyBase64: string;
  vaultId: string;
  itemId: string;
  keyVersion?: number;
}): Promise<{ bundle: EncryptedItemBundle; itemKeyBase64: string }> {
  const keyVersion = params.keyVersion ?? 1;
  const itemKeyBase64 = await generateRandomKeyBase64();
  const payloadIv = generateIvBytes();

  const aadContext: AadContext = {
    vaultId: params.vaultId,
    resourceId: params.itemId,
    resourceType: "VAULT_ITEM",
    keyVersion,
  };

  const plaintextBytes = new TextEncoder().encode(JSON.stringify(params.payload));
  const { ciphertextBase64, ivBase64 } = await aesGcmEncryptRaw({
    plaintextBytes,
    keyBase64: itemKeyBase64,
    ivBytes: payloadIv,
    aadContext,
  });

  // Wrap the per-item key (IEK) under the VMK's HKDF item-wrapping subkey
  const itemKek = await deriveHkdfSubkey(
    params.vaultMasterKeyBase64,
    "dusk-v1-item-kek",
    keyVersion
  );
  const wrapIv = generateIvBytes();
  const wrapAad = encodeAadContext({
    vaultId: params.vaultId,
    resourceId: params.itemId,
    resourceType: "VAULT_ITEM",
    keyVersion,
  });

  const wrappedKeyBuf = await getWebCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapIv),
      additionalData: toArrayBuffer(wrapAad),
      tagLength: AES_GCM_TAG_BITS,
    },
    itemKek,
    toArrayBuffer(base64ToBytes(itemKeyBase64))
  );

  return {
    itemKeyBase64,
    bundle: {
      schemaVersion: CRYPTO_SCHEMA_VERSION,
      keyVersion,
      ciphertextBase64,
      ivBase64,
      wrappedItemKeyBase64: bytesToBase64(new Uint8Array(wrappedKeyBuf)),
      wrappedItemKeyIvBase64: bytesToBase64(wrapIv),
      aadContext,
    },
  };
}

/**
 * Unwraps the per-item key (IEK) using the Vault Master Key and decrypts the Vault Item JSON payload.
 */
export async function decryptVaultItemPayload<T = unknown>(params: {
  bundle: EncryptedItemBundle;
  vaultMasterKeyBase64: string;
}): Promise<{ payload: T; itemKeyBase64: string }> {
  const { bundle, vaultMasterKeyBase64 } = params;

  try {
    const itemKek = await deriveHkdfSubkey(
      vaultMasterKeyBase64,
      "dusk-v1-item-kek",
      bundle.keyVersion
    );
    const wrapIv = base64ToBytes(bundle.wrappedItemKeyIvBase64);
    const wrappedKeyBytes = base64ToBytes(bundle.wrappedItemKeyBase64);
    if (wrapIv.byteLength !== AES_GCM_IV_BYTES) {
      throw new CryptoTamperOrAuthError("Invalid wrapped key IV length.");
    }

    const wrapAad = encodeAadContext(bundle.aadContext);
    const unwrappedKeyBuf = await getWebCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(wrapIv),
        additionalData: toArrayBuffer(wrapAad),
        tagLength: AES_GCM_TAG_BITS,
      },
      itemKek,
      toArrayBuffer(wrappedKeyBytes)
    );

    const itemKeyBase64 = bytesToBase64(new Uint8Array(unwrappedKeyBuf));
    const decryptedBytes = await aesGcmDecryptRaw({
      ciphertextBase64: bundle.ciphertextBase64,
      ivBase64: bundle.ivBase64,
      keyBase64: itemKeyBase64,
      aadContext: bundle.aadContext,
    });

    const jsonString = new TextDecoder().decode(decryptedBytes);
    return {
      payload: JSON.parse(jsonString) as T,
      itemKeyBase64,
    };
  } catch (err) {
    if (err instanceof CryptoTamperOrAuthError) throw err;
    throw new CryptoTamperOrAuthError();
  }
}

/**
 * Rotates the wrapped Item Key (IEK) from an old Vault Master Key to a new Vault Master Key
 * (keyVersion -> newKeyVersion) and re-binds the item ciphertext AAD to the new keyVersion.
 */
export async function rotateEncryptedItemBundle(params: {
  bundle: EncryptedItemBundle;
  oldVaultMasterKeyBase64: string;
  newVaultMasterKeyBase64: string;
  newKeyVersion: number;
}): Promise<EncryptedItemBundle> {
  if (params.newKeyVersion <= params.bundle.keyVersion) {
    throw new Error("New keyVersion must be strictly greater than current keyVersion.");
  }

  const { payload } = await decryptVaultItemPayload({
    bundle: params.bundle,
    vaultMasterKeyBase64: params.oldVaultMasterKeyBase64,
  });

  const { bundle: rotatedBundle } = await encryptVaultItemPayload({
    payload,
    vaultMasterKeyBase64: params.newVaultMasterKeyBase64,
    vaultId: params.bundle.aadContext.vaultId,
    itemId: params.bundle.aadContext.resourceId,
    keyVersion: params.newKeyVersion,
  });

  return rotatedBundle;
}

/**
 * Encrypts a binary file attachment on the client with a fresh 256-bit File Encryption Key (FEK),
 * computes a SHA-256 integrity hash over the encrypted blob, encrypts filename/MIME metadata,
 * and wraps the FEK under the Vault Master Key's HKDF file-wrapping subkey.
 */
export async function encryptVaultFileAttachment(params: {
  fileBytes: Uint8Array;
  metadata: { fileName: string; mimeType: string; sizeBytes: number };
  vaultMasterKeyBase64: string;
  vaultId: string;
  fileId: string;
  keyVersion?: number;
}): Promise<EncryptedFileBundle> {
  const keyVersion = params.keyVersion ?? 1;
  const fileKeyBase64 = await generateRandomKeyBase64();
  const blobIv = generateIvBytes();
  const metaIv = generateIvBytes();

  const aadContext: AadContext = {
    vaultId: params.vaultId,
    resourceId: params.fileId,
    resourceType: "VAULT_FILE",
    keyVersion,
  };

  const { ciphertextBase64: blobCiphertextBase64, ivBase64: blobIvBase64 } =
    await aesGcmEncryptRaw({
      plaintextBytes: params.fileBytes,
      keyBase64: fileKeyBase64,
      ivBytes: blobIv,
      aadContext,
    });

  const encryptedBlob = base64ToBytes(blobCiphertextBase64);
  const hashBuffer = await getWebCrypto().subtle.digest(
    "SHA-256",
    toArrayBuffer(encryptedBlob)
  );
  const ciphertextSha256Hex = bytesToHex(new Uint8Array(hashBuffer));

  const metaBytes = new TextEncoder().encode(JSON.stringify(params.metadata));
  const { ciphertextBase64: encryptedMetaBase64, ivBase64: metaIvBase64 } =
    await aesGcmEncryptRaw({
      plaintextBytes: metaBytes,
      keyBase64: fileKeyBase64,
      ivBytes: metaIv,
      aadContext,
    });

  const fileKek = await deriveHkdfSubkey(
    params.vaultMasterKeyBase64,
    "dusk-v1-file-kek",
    keyVersion
  );
  const wrapIv = generateIvBytes();
  const wrapAad = encodeAadContext(aadContext);

  const wrappedFileKeyBuf = await getWebCrypto().subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapIv),
      additionalData: toArrayBuffer(wrapAad),
      tagLength: AES_GCM_TAG_BITS,
    },
    fileKek,
    toArrayBuffer(base64ToBytes(fileKeyBase64))
  );

  return {
    schemaVersion: CRYPTO_SCHEMA_VERSION,
    keyVersion,
    encryptedBlob,
    blobIvBase64,
    ciphertextSha256Hex,
    encryptedMetaBase64,
    metaIvBase64,
    wrappedFileKeyBase64: bytesToBase64(new Uint8Array(wrappedFileKeyBuf)),
    wrappedFileKeyIvBase64: bytesToBase64(wrapIv),
    aadContext,
  };
}

/**
 * Verifies the SHA-256 integrity hash of an encrypted file blob, unwraps its File Encryption Key (FEK),
 * and decrypts both the file metadata and binary content.
 */
export async function decryptVaultFileAttachment(params: {
  bundle: EncryptedFileBundle;
  vaultMasterKeyBase64: string;
}): Promise<{
  fileBytes: Uint8Array;
  metadata: { fileName: string; mimeType: string; sizeBytes: number };
}> {
  const { bundle, vaultMasterKeyBase64 } = params;

  // 1. Verify SHA-256 integrity of encrypted blob before decryption
  const hashBuffer = await getWebCrypto().subtle.digest(
    "SHA-256",
    toArrayBuffer(bundle.encryptedBlob)
  );
  const actualSha256Hex = bytesToHex(new Uint8Array(hashBuffer));
  if (actualSha256Hex !== bundle.ciphertextSha256Hex) {
    throw new CryptoTamperOrAuthError(
      "Encrypted file integrity check failed: SHA-256 digest mismatch."
    );
  }

  try {
    const fileKek = await deriveHkdfSubkey(
      vaultMasterKeyBase64,
      "dusk-v1-file-kek",
      bundle.keyVersion
    );
    const wrapIv = base64ToBytes(bundle.wrappedFileKeyIvBase64);
    const wrappedFileKeyBytes = base64ToBytes(bundle.wrappedFileKeyBase64);
    const wrapAad = encodeAadContext(bundle.aadContext);

    const unwrappedFileKeyBuf = await getWebCrypto().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(wrapIv),
        additionalData: toArrayBuffer(wrapAad),
        tagLength: AES_GCM_TAG_BITS,
      },
      fileKek,
      toArrayBuffer(wrappedFileKeyBytes)
    );

    const fileKeyBase64 = bytesToBase64(new Uint8Array(unwrappedFileKeyBuf));

    const metaPlainBytes = await aesGcmDecryptRaw({
      ciphertextBase64: bundle.encryptedMetaBase64,
      ivBase64: bundle.metaIvBase64,
      keyBase64: fileKeyBase64,
      aadContext: bundle.aadContext,
    });

    const fileBytes = await aesGcmDecryptRaw({
      ciphertextBase64: bytesToBase64(bundle.encryptedBlob),
      ivBase64: bundle.blobIvBase64,
      keyBase64: fileKeyBase64,
      aadContext: bundle.aadContext,
    });

    return {
      fileBytes,
      metadata: JSON.parse(new TextDecoder().decode(metaPlainBytes)),
    };
  } catch (err) {
    if (err instanceof CryptoTamperOrAuthError) throw err;
    throw new CryptoTamperOrAuthError();
  }
}