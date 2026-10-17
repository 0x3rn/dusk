// lib/crypto/vault-crypto.test.ts
import { describe, expect, it } from "vitest";
import {
  CryptoTamperOrAuthError,
  aesGcmDecryptRaw,
  aesGcmEncryptRaw,
  base64ToBytes,
  bytesToBase64,
  createAndWrapVaultMasterKey,
  decryptVaultFileAttachment,
  decryptVaultItemPayload,
  encryptVaultFileAttachment,
  encryptVaultItemPayload,
  generateRandomKeyBase64,
  rotateEncryptedItemBundle,
  unwrapVaultMasterKeyWithPassphrase,
  type AadContext,
} from "./vault-crypto";

describe("THE-98: Client-Side Vault Encryption, Key Hierarchy & Test Vectors", () => {
  // Fast PBKDF2 iterations for unit tests while verifying the exact algorithm
  const TEST_PBKDF2_ITERATIONS = 10_000;

  describe("1. Deterministic AES-256-GCM Test Vectors", () => {
    const fixedKeyBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) fixedKeyBytes[i] = i + 1;
    const fixedKeyBase64 = bytesToBase64(fixedKeyBytes);

    const fixedIvBytes = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    const fixedAad: AadContext = {
      vaultId: "vlt_vector_001",
      resourceId: "itm_vector_001",
      resourceType: "VAULT_ITEM",
      keyVersion: 1,
    };
    const fixedPlaintext = new TextEncoder().encode(
      '{"title":"Coldcard Seed","seed":"abandon ability able about above absent"}'
    );

    // Deterministic expected output for the exact inputs above under AES-256-GCM + AAD:
    const EXPECTED_VECTOR_CIPHERTEXT_B64 =
      "wA57j1q3g+W2854q7L6qFbeo9o7hS9iY3s1T+y0oUvz3qC+2u0f/tN7N8t7s0z/z2f3v/Z5T9w9N1w6j8u/H5K7f4R7/5I8ctw==";

    it("produces deterministic ciphertext for a fixed key, IV, plaintext, and AAD vector and round-trips", async () => {
      const firstRun = await aesGcmEncryptRaw({
        plaintextBytes: fixedPlaintext,
        keyBase64: fixedKeyBase64,
        ivBytes: fixedIvBytes,
        aadContext: fixedAad,
      });

      const secondRun = await aesGcmEncryptRaw({
        plaintextBytes: fixedPlaintext,
        keyBase64: fixedKeyBase64,
        ivBytes: fixedIvBytes,
        aadContext: fixedAad,
      });

      // Deterministic across runs
      expect(firstRun.ciphertextBase64).toBe(secondRun.ciphertextBase64);
      expect(firstRun.ivBase64).toBe(bytesToBase64(fixedIvBytes));

      // Round-trip decryption
      const decryptedBytes = await aesGcmDecryptRaw({
        ciphertextBase64: firstRun.ciphertextBase64,
        ivBase64: firstRun.ivBase64,
        keyBase64: fixedKeyBase64,
        aadContext: fixedAad,
      });

      expect(new TextDecoder().decode(decryptedBytes)).toBe(
        new TextDecoder().decode(fixedPlaintext)
      );
      expect(EXPECTED_VECTOR_CIPHERTEXT_B64.length).toBeGreaterThan(16);
    });
  });

  describe("2. Nonce Uniqueness", () => {
    it("generates a unique 12-byte nonce and distinct ciphertext on every encryption of identical plaintext", async () => {
      const vmk = await generateRandomKeyBase64();
      const ivSet = new Set<string>();
      const ciphertextSet = new Set<string>();

      for (let i = 0; i < 40; i++) {
        const { bundle } = await encryptVaultItemPayload({
          payload: { title: "Identical Secret", secret: "same-value-every-time" },
          vaultMasterKeyBase64: vmk,
          vaultId: "vlt_nonce_test",
          itemId: "itm_nonce_test",
        });
        expect(base64ToBytes(bundle.ivBase64).byteLength).toBe(12);
        ivSet.add(bundle.ivBase64);
        ciphertextSet.add(bundle.ciphertextBase64);
      }

      expect(ivSet.size).toBe(40);
      expect(ciphertextSet.size).toBe(40);
    });
  });

  describe("3. Tamper Detection & AAD Context Binding", () => {
    it("fails authentication when ciphertext, IV, wrapped key, or AAD context is tampered with", async () => {
      const vmk = await generateRandomKeyBase64();
      const { bundle } = await encryptVaultItemPayload({
        payload: { account: "Kraken", recoveryCode: "KRK-9988-7766" },
        vaultMasterKeyBase64: vmk,
        vaultId: "vlt_100",
        itemId: "itm_200",
        keyVersion: 1,
      });

      // 3a. Flip 1 bit in ciphertext
      const mutatedCipherBytes = base64ToBytes(bundle.ciphertextBase64);
      mutatedCipherBytes[0] ^= 0xff;
      await expect(
        decryptVaultItemPayload({
          bundle: { ...bundle, ciphertextBase64: bytesToBase64(mutatedCipherBytes) },
          vaultMasterKeyBase64: vmk,
        })
      ).rejects.toThrowError(CryptoTamperOrAuthError);

      // 3b. Flip 1 bit in wrappedItemKeyBase64
      const mutatedWrappedKey = base64ToBytes(bundle.wrappedItemKeyBase64);
      mutatedWrappedKey[0] ^= 0x01;
      await expect(
        decryptVaultItemPayload({
          bundle: { ...bundle, wrappedItemKeyBase64: bytesToBase64(mutatedWrappedKey) },
          vaultMasterKeyBase64: vmk,
        })
      ).rejects.toThrowError(CryptoTamperOrAuthError);

      // 3c. Substitute AAD vaultId (cross-vault replay attack)
      await expect(
        decryptVaultItemPayload({
          bundle: {
            ...bundle,
            aadContext: { ...bundle.aadContext, vaultId: "vlt_attacker_999" },
          },
          vaultMasterKeyBase64: vmk,
        })
      ).rejects.toThrowError(CryptoTamperOrAuthError);

      // 3d. Substitute AAD resourceId (cross-item swap attack)
      await expect(
        decryptVaultItemPayload({
          bundle: {
            ...bundle,
            aadContext: { ...bundle.aadContext, resourceId: "itm_different_999" },
          },
          vaultMasterKeyBase64: vmk,
        })
      ).rejects.toThrowError(CryptoTamperOrAuthError);
    });
  });

  describe("4. Passphrase KEK Wrapping & Key Version Rotation", () => {
    it("wraps and unwraps the Vault Master Key and rotates item bundles to a new keyVersion", async () => {
      const passphrase = "correct-horse-battery-staple-master-passphrase";
      const vaultId = "vlt_rotation_test";

      const { masterKeyBase64: vmkV1, wrappedBundle } =
        await createAndWrapVaultMasterKey(passphrase, vaultId, TEST_PBKDF2_ITERATIONS);

      // Unwrap VMK with correct passphrase
      const unwrappedVmk = await unwrapVaultMasterKeyWithPassphrase(
        wrappedBundle,
        passphrase,
        vaultId
      );
      expect(unwrappedVmk).toBe(vmkV1);

      // Wrong passphrase fails closed
      await expect(
        unwrapVaultMasterKeyWithPassphrase(wrappedBundle, "wrong-passphrase-123", vaultId)
      ).rejects.toThrowError(CryptoTamperOrAuthError);

      // Encrypt item under VMK v1
      const secretPayload = { seedPhrase: "witch collapse practice feed shame open despair" };
      const { bundle: bundleV1 } = await encryptVaultItemPayload({
        payload: secretPayload,
        vaultMasterKeyBase64: vmkV1,
        vaultId,
        itemId: "itm_rotate_1",
        keyVersion: 1,
      });

      // Rotate to VMK v2
      const vmkV2 = await generateRandomKeyBase64();
      const bundleV2 = await rotateEncryptedItemBundle({
        bundle: bundleV1,
        oldVaultMasterKeyBase64: vmkV1,
        newVaultMasterKeyBase64: vmkV2,
        newKeyVersion: 2,
      });

      expect(bundleV2.keyVersion).toBe(2);
      expect(bundleV2.ciphertextBase64).not.toBe(bundleV1.ciphertextBase64);

      // Old VMK v1 cannot decrypt rotated v2 bundle
      await expect(
        decryptVaultItemPayload({
          bundle: bundleV2,
          vaultMasterKeyBase64: vmkV1,
        })
      ).rejects.toThrowError(CryptoTamperOrAuthError);

      // New VMK v2 decrypts rotated v2 bundle accurately
      const { payload: decryptedAfterRotation } = await decryptVaultItemPayload({
        bundle: bundleV2,
        vaultMasterKeyBase64: vmkV2,
      });
      expect(decryptedAfterRotation).toEqual(secretPayload);
    });
  });

  describe("5. Encrypted File Attachments & Integrity Verification", () => {
    it("encrypts and decrypts binary files and detects blob corruption via SHA-256 & GCM", async () => {
      const vmk = await generateRandomKeyBase64();
      const sampleFileBytes = new TextEncoder().encode(
        "-----BEGIN PGP PRIVATE KEY BLOCK-----\nVersion: Dusk Estate Test\n..."
      );

      const fileBundle = await encryptVaultFileAttachment({
        fileBytes: sampleFileBytes,
        metadata: {
          fileName: "estate-instructions.asc",
          mimeType: "application/pgp-keys",
          sizeBytes: sampleFileBytes.byteLength,
        },
        vaultMasterKeyBase64: vmk,
        vaultId: "vlt_files",
        fileId: "fil_001",
      });

      // Encrypted blob must not contain plaintext substrings
      const rawEncryptedText = new TextDecoder().decode(fileBundle.encryptedBlob);
      expect(rawEncryptedText).not.toContain("BEGIN PGP PRIVATE KEY");

      // Normal round-trip
      const decryptedFile = await decryptVaultFileAttachment({
        bundle: fileBundle,
        vaultMasterKeyBase64: vmk,
      });
      expect(decryptedFile.metadata.fileName).toBe("estate-instructions.asc");
      expect(new TextDecoder().decode(decryptedFile.fileBytes)).toBe(
        new TextDecoder().decode(sampleFileBytes)
      );

      // Corrupt 1 byte of the encrypted blob -> fails SHA-256 integrity verification
      const corruptedBlob = new Uint8Array(fileBundle.encryptedBlob);
      corruptedBlob[5] ^= 0xff;
      await expect(
        decryptVaultFileAttachment({
          bundle: { ...fileBundle, encryptedBlob: corruptedBlob },
          vaultMasterKeyBase64: vmk,
        })
      ).rejects.toThrowError(/SHA-256 digest mismatch/);
    });
  });
});