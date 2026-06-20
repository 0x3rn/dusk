// lib/crypto.ts

/**
 * Utility functions for true Zero-Knowledge Client-Side Encryption
 * utilizing the native Web Crypto API.
 */

// Helper to convert ArrayBuffer to Base64
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper to convert Base64 to ArrayBuffer
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generates a new AES-GCM 256-bit Vault Key and returns it as a Base64 string.
 * This key is NEVER sent to the server in plaintext.
 */
export async function generateVaultKey(): Promise<string> {
  const key = await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  const exported = await window.crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(exported);
}

/**
 * Encrypts a JSON payload using the Base64 Vault Key.
 * Returns Base64 encoded ciphertext and initialization vector (IV).
 */
export async function encryptVaultData(
  data: unknown, 
  base64Key: string
): Promise<{ ciphertext: string; iv: string }> {
  // Import the key
  const rawKey = base64ToArrayBuffer(base64Key);
  const key = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    false,
    ["encrypt"]
  );

  // Generate a random IV
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedData = new TextEncoder().encode(JSON.stringify(data));

  // Encrypt the data
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encodedData
  );

  return {
    ciphertext: arrayBufferToBase64(encryptedBuffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypts a Base64 ciphertext back into the original JSON payload using the Vault Key and IV.
 */
export async function decryptVaultData(
  ciphertextBase64: string,
  ivBase64: string,
  base64Key: string
): Promise<any> {
  const rawKey = base64ToArrayBuffer(base64Key);
  const key = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    false,
    ["decrypt"]
  );

  const ciphertextBuffer = base64ToArrayBuffer(ciphertextBase64);
  const ivBuffer = base64ToArrayBuffer(ivBase64);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(ivBuffer),
    },
    key,
    ciphertextBuffer
  );

  const decodedString = new TextDecoder().decode(decryptedBuffer);
  return JSON.parse(decodedString);
}

/**
 * Constructs the Emergency Access URL with the key securely placed in the URL hash fragment.
 */
export function generateEmergencyUrl(contactId: string, vaultKey: string): string {
  // In production, we'd use process.env.NEXT_PUBLIC_APP_URL, but fallback to window origin
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://dusk.app";
  return `${baseUrl}/unlock/${contactId}#${vaultKey}`;
}
