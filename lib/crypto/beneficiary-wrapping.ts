// lib/crypto/beneficiary-wrapping.ts
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  AES_KEY_BITS,
  CRYPTO_SCHEMA_VERSION,
  CryptoTamperOrAuthError,
  aesGcmDecryptRaw,
  base64ToBytes,
  bytesToBase64,
  encodeAadContext,
  generateIvBytes,
  type EncryptedItemBundle,
} from "./vault-crypto";

/**
 * THE-101: Selective Beneficiary Public-Key Wrapping (ECDH P-256 + HKDF-SHA256 + AES-256-GCM)
 *
 * Construction:
 * 1. Each Beneficiary has an asymmetric ECDH P-256 keypair:
 *    - `publicKeyBase64` (SPKI format) is stored on their verified `Contact` record.
 *    - `privateKeyBase64` (PKCS#8 format) is held only by the Beneficiary (or in their #url fragment / key file).
 * 2. To assign a specific Vault Item's `itemKeyBase64` (IEK) to Beneficiary `contactId`:
 *    - The owner's client generates a fresh one-time Ephemeral ECDH P-256 keypair.
 *    - Computes `sharedBits = ECDH(ephemeralPrivateKey, beneficiaryPublicKey)`.
 *    - Derives a 256-bit AES-GCM wrapping key via `HKDF-SHA256` with domain info:
 *      `dusk-v1-beneficiary-wrap|vault:${vaultId}|contact:${contactId}|item:${itemId}|kv:${keyVersion}`.
 *    - Encrypts the 32-byte `itemKeyBase64` with `AES-256-GCM` and canonical `AAD` bound to
 *      `{ vaultId, resourceId: "${contactId}:${itemId}", resourceType: "RELEASE_PACKAGE", keyVersion }`.
 * 3. Neither the Vault Master Key (VMK) nor any unassigned Item Keys are ever wrapped for the Beneficiary.
 */

export const BENEFICIARY_KEY_ALGORITHM = "ECDH-P256-HKDF-AES256GCM";

export interface BeneficiaryKeyPair {
  publicKeyBase64: string;  // SPKI exported public key (safe for server storage)
  privateKeyBase64: string; // PKCS#8 exported private key (secret; never sent to server)
  algorithm: string;
}

export interface BeneficiaryWrappedItemKey {
  schemaVersion: number;
  keyVersion: number;
  vaultId: string;
  contactId: string;
  itemId: string;
  beneficiaryWrappedKeyBase64: string;
  beneficiaryWrappedKeyIv: string;
  ephemeralPublicKeyBase64: string;
  algorithm: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * Generates an asymmetric ECDH P-256 keypair for a Beneficiary on the client.
 */
export async function generateBeneficiaryKeyPair(): Promise<BeneficiaryKeyPair> {
  const keyPair = await globalThis.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"]
  );

  const spkiPub = await globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const pkcs8Priv = await globalThis.crypto.subtle.exportKey("pkcs8", keyPair.privateKey);

  return {
    publicKeyBase64: bytesToBase64(new Uint8Array(spkiPub)),
    privateKeyBase64: bytesToBase64(new Uint8Array(pkcs8Priv)),
    algorithm: BENEFICIARY_KEY_ALGORITHM,
  };
}

async function deriveSharedWrappingKey(params: {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  vaultId: string;
  contactId: string;
  itemId: string;
  keyVersion: number;
}): Promise<CryptoKey> {
  const sharedBits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: params.publicKey,
    },
    params.privateKey,
    256
  );

  const hkdfBaseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"]
  );

  const salt = new TextEncoder().encode("dusk-beneficiary-ecdh-hkdf-v1");
  const info = new TextEncoder().encode(
    `dusk-v1-beneficiary-wrap|vault:${params.vaultId}|contact:${params.contactId}|item:${params.itemId}|kv:${params.keyVersion}`
  );

  return globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(info),
    },
    hkdfBaseKey,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Wraps a single Item Encryption Key (`itemKeyBase64`) specifically for a single Beneficiary's
 * public key using ephemeral-static ECDH + HKDF-SHA256 + AES-256-GCM.
 */
export async function wrapItemKeyForBeneficiary(params: {
  itemKeyBase64: string;
  beneficiaryPublicKeyBase64: string;
  vaultId: string;
  contactId: string;
  itemId: string;
  keyVersion?: number;
}): Promise<BeneficiaryWrappedItemKey> {
  const keyVersion = params.keyVersion ?? 1;
  const rawItemKey = base64ToBytes(params.itemKeyBase64);
  if (rawItemKey.byteLength !== 32) {
    throw new Error("Item key must be 32 bytes (256 bits).");
  }

  let beneficiaryPublicKey: CryptoKey;
  try {
    const pubBytes = base64ToBytes(params.beneficiaryPublicKeyBase64);
    beneficiaryPublicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      toArrayBuffer(pubBytes),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );
  } catch {
    throw new CryptoTamperOrAuthError("Invalid beneficiary public key.");
  }

  // Generate fresh ephemeral ECDH P-256 keypair for forward secrecy & per-assignment isolation
  const ephemeralPair = await globalThis.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const ephemeralSpki = await globalThis.crypto.subtle.exportKey(
    "spki",
    ephemeralPair.publicKey
  );

  const wrappingKey = await deriveSharedWrappingKey({
    privateKey: ephemeralPair.privateKey,
    publicKey: beneficiaryPublicKey,
    vaultId: params.vaultId,
    contactId: params.contactId,
    itemId: params.itemId,
    keyVersion,
  });

  const iv = generateIvBytes();
  const aadBytes = encodeAadContext({
    vaultId: params.vaultId,
    resourceId: `${params.contactId}:${params.itemId}`,
    resourceType: "RELEASE_PACKAGE",
    keyVersion,
  });

  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aadBytes),
      tagLength: AES_GCM_TAG_BITS,
    },
    wrappingKey,
    toArrayBuffer(rawItemKey)
  );

  return {
    schemaVersion: CRYPTO_SCHEMA_VERSION,
    keyVersion,
    vaultId: params.vaultId,
    contactId: params.contactId,
    itemId: params.itemId,
    beneficiaryWrappedKeyBase64: bytesToBase64(new Uint8Array(encryptedBuf)),
    beneficiaryWrappedKeyIv: bytesToBase64(iv),
    ephemeralPublicKeyBase64: bytesToBase64(new Uint8Array(ephemeralSpki)),
    algorithm: BENEFICIARY_KEY_ALGORITHM,
  };
}

/**
 * Unwraps an assigned Item Encryption Key (`itemKeyBase64`) on the Beneficiary's client
 * using the Beneficiary's private key.
 * Fails closed with CryptoTamperOrAuthError if another beneficiary's private key is used
 * or if `contactId` / `itemId` / `vaultId` was tampered with.
 */
export async function unwrapItemKeyForBeneficiary(params: {
  wrappedGrant: BeneficiaryWrappedItemKey;
  beneficiaryPrivateKeyBase64: string;
}): Promise<string> {
  const { wrappedGrant, beneficiaryPrivateKeyBase64 } = params;
  const iv = base64ToBytes(wrappedGrant.beneficiaryWrappedKeyIv);
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new CryptoTamperOrAuthError("Invalid IV length on beneficiary wrapped key.");
  }

  try {
    const privBytes = base64ToBytes(beneficiaryPrivateKeyBase64);
    const ephemeralPubBytes = base64ToBytes(wrappedGrant.ephemeralPublicKeyBase64);

    const beneficiaryPrivateKey = await globalThis.crypto.subtle.importKey(
      "pkcs8",
      toArrayBuffer(privBytes),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );

    const ephemeralPublicKey = await globalThis.crypto.subtle.importKey(
      "spki",
      toArrayBuffer(ephemeralPubBytes),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      []
    );

    const wrappingKey = await deriveSharedWrappingKey({
      privateKey: beneficiaryPrivateKey,
      publicKey: ephemeralPublicKey,
      vaultId: wrappedGrant.vaultId,
      contactId: wrappedGrant.contactId,
      itemId: wrappedGrant.itemId,
      keyVersion: wrappedGrant.keyVersion,
    });

    const aadBytes = encodeAadContext({
      vaultId: wrappedGrant.vaultId,
      resourceId: `${wrappedGrant.contactId}:${wrappedGrant.itemId}`,
      resourceType: "RELEASE_PACKAGE",
      keyVersion: wrappedGrant.keyVersion,
    });

    const ciphertextBytes = base64ToBytes(wrappedGrant.beneficiaryWrappedKeyBase64);
    const decryptedBuf = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aadBytes),
        tagLength: AES_GCM_TAG_BITS,
      },
      wrappingKey,
      toArrayBuffer(ciphertextBytes)
    );

    return bytesToBase64(new Uint8Array(decryptedBuf));
  } catch (err) {
    if (err instanceof CryptoTamperOrAuthError) throw err;
    throw new CryptoTamperOrAuthError(
      "Beneficiary key unwrapping failed: unauthorized beneficiary private key or tampered package."
    );
  }
}

/**
 * Decrypts a Vault Item directly on the Beneficiary's device using their unwrapped Item Key
 * (without ever needing or having access to the owner's Vault Master Key).
 */
export async function decryptAssignedItemAsBeneficiary<T = unknown>(params: {
  itemEnvelope: Pick<
    EncryptedItemBundle,
    "ciphertextBase64" | "ivBase64" | "aadContext"
  >;
  wrappedGrant: BeneficiaryWrappedItemKey;
  beneficiaryPrivateKeyBase64: string;
}): Promise<T> {
  if (params.itemEnvelope.aadContext.resourceId !== params.wrappedGrant.itemId) {
    throw new CryptoTamperOrAuthError(
      "Item envelope ID does not match the beneficiary release grant itemId."
    );
  }

  const itemKeyBase64 = await unwrapItemKeyForBeneficiary({
    wrappedGrant: params.wrappedGrant,
    beneficiaryPrivateKeyBase64: params.beneficiaryPrivateKeyBase64,
  });

  const plainBytes = await aesGcmDecryptRaw({
    ciphertextBase64: params.itemEnvelope.ciphertextBase64,
    ivBase64: params.itemEnvelope.ivBase64,
    keyBase64: itemKeyBase64,
    aadContext: params.itemEnvelope.aadContext,
  });

  return JSON.parse(new TextDecoder().decode(plainBytes)) as T;
}