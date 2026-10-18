// lib/services/vault-workspace-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
} from "../auth/security";
import {
  assertZeroKnowledgePayload,
  redactForAuditLog,
} from "../domain/trust-boundary";
import {
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BITS,
  CRYPTO_SCHEMA_VERSION,
  CryptoTamperOrAuthError,
  base64ToBytes,
  bytesToBase64,
  deriveHkdfSubkey,
  encodeAadContext,
  generateIvBytes,
} from "../crypto/vault-crypto";
import type { ItemCategory } from "@prisma/client";

/**
 * THE-106: Encrypted Vault Items, Folders, Client-Side Search & Encrypted File Attachments
 *
 * Security Invariants:
 * 1. Structured item fields (usernames, passwords, seed phrases, PINs, account numbers, wishes, tags)
 *    are validated and encrypted on the client BEFORE reaching the server.
 * 2. Folder names are encrypted on the client under the VMK's HKDF folder subkey ("dusk-v1-folder-key").
 * 3. File attachments are encrypted on the client with a unique 256-bit File Encryption Key (FEK),
 *    bound to a SHA-256 ciphertext integrity hash (`ciphertextSha256Hex`).
 * 4. Search over item titles, tags, and metadata runs strictly over decrypted client memory.
 */

export const MAX_ENCRYPTED_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

// Client-side structured schemas (used before client encryption & after client decryption)
export const TypedVaultItemPlaintextSchema = z.discriminatedUnion("category", [
  z.object({
    category: z.literal("CREDENTIAL"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    serviceUrl: z.string().trim().max(500).optional(),
    username: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(500),
    totpOrBackupCodes: z.string().max(2000).optional(),
    notes: z.string().max(10000).optional(),
  }),
  z.object({
    category: z.literal("CRYPTO_RECOVERY"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    walletType: z.string().trim().min(1).max(120),
    networkOrChain: z.string().trim().max(120).optional(),
    seedPhraseOrPrivateKey: z.string().trim().min(1).max(5000),
    derivationPathOrPassphrase: z.string().max(1000).optional(),
    instructions: z.string().max(10000).optional(),
  }),
  z.object({
    category: z.literal("DOCUMENT"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    documentType: z.string().trim().min(1).max(120),
    physicalOrCloudLocation: z.string().trim().max(500).optional(),
    summaryAndInstructions: z.string().min(1).max(20000),
  }),
  z.object({
    category: z.literal("DEVICE_ACCESS"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    deviceName: z.string().trim().min(1).max(160),
    pinOrPasscode: z.string().min(1).max(500),
    diskRecoveryKey: z.string().max(2000).optional(),
    instructions: z.string().max(10000).optional(),
  }),
  z.object({
    category: z.literal("FINANCIAL_INSTRUCTION"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    institutionName: z.string().trim().min(1).max(160),
    accountOrPolicyIdentifier: z.string().trim().min(1).max(200),
    advisorContactInfo: z.string().max(1000).optional(),
    instructions: z.string().min(1).max(15000),
  }),
  z.object({
    category: z.literal("FINAL_WISH"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    intendedRecipientNote: z.string().trim().max(200).optional(),
    messageBody: z.string().min(1).max(50000),
  }),
  z.object({
    category: z.literal("SECURE_NOTE"),
    title: z.string().trim().min(1).max(160),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    content: z.string().min(1).max(50000),
  }),
]);

export type TypedVaultItemPlaintext = z.infer<
  typeof TypedVaultItemPlaintextSchema
>;

export const CreateEncryptedFolderInputSchema = z.object({
  vaultId: z.string().min(1),
  encryptedNameBase64: z.string().min(16),
  nameIvBase64: z.string().min(16),
  keyVersion: z.number().int().positive().default(1),
  sortOrder: z.number().int().nonnegative().default(0),
});

export const UpdateEncryptedItemEnvelopeInputSchema = z.object({
  itemId: z.string().min(1),
  folderId: z.string().nullable().optional(),
  category: z
    .enum([
      "CREDENTIAL",
      "CRYPTO_RECOVERY",
      "DOCUMENT",
      "DEVICE_ACCESS",
      "FINANCIAL_INSTRUCTION",
      "FINAL_WISH",
      "SECURE_NOTE",
    ])
    .optional(),
  isFavorite: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  ciphertextBase64: z.string().min(24).optional(),
  ivBase64: z.string().min(16).optional(),
  wrappedItemKeyBase64: z.string().min(24).optional(),
  wrappedItemKeyIvBase64: z.string().min(16).optional(),
  keyVersion: z.number().int().positive().optional(),
});

export const UploadEncryptedFileInputSchema = z.object({
  vaultId: z.string().min(1),
  itemId: z.string().min(1),
  storageBlobKey: z.string().min(8).max(250),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(
      MAX_ENCRYPTED_FILE_BYTES,
      `Encrypted attachment cannot exceed ${MAX_ENCRYPTED_FILE_BYTES} bytes (25 MB).`
    ),
  ciphertextSha256Hex: z.string().regex(/^[a-f0-9]{64}$/),
  encryptedMetaBase64: z.string().min(24),
  metaIvBase64: z.string().min(16),
  blobIvBase64: z.string().min(16),
  wrappedFileKeyBase64: z.string().min(24),
  wrappedFileKeyIvBase64: z.string().min(16),
  keyVersion: z.number().int().positive().default(1),
});

export interface VaultFolderRecord {
  id: string;
  vaultId: string;
  userId: string;
  encryptedNameBase64: string;
  nameIvBase64: string;
  keyVersion: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceEncryptedItemRecord {
  id: string;
  vaultId: string;
  userId: string;
  folderId: string | null;
  category: ItemCategory;
  isFavorite: boolean;
  sortOrder: number;
  schemaVersion: number;
  keyVersion: number;
  ciphertextBase64: string;
  ivBase64: string;
  wrappedItemKeyBase64: string;
  wrappedItemKeyIvBase64: string;
  aadResourceId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface EncryptedFileRecord {
  id: string;
  vaultId: string;
  userId: string;
  itemId: string | null;
  storageBlobKey: string;
  sizeBytes: number;
  ciphertextSha256Hex: string;
  encryptedMetaBase64: string;
  metaIvBase64: string;
  blobIvBase64: string;
  wrappedFileKeyBase64: string;
  wrappedFileKeyIvBase64: string;
  keyVersion: number;
  createdAt: Date;
}

export interface VaultWorkspacePersistencePort {
  findVaultById(vaultId: string): Promise<{ id: string; userId: string } | null>;
  createFolder(data: {
    vaultId: string;
    userId: string;
    encryptedNameBase64: string;
    nameIvBase64: string;
    keyVersion: number;
    sortOrder: number;
  }): Promise<VaultFolderRecord>;
  findFolderById(folderId: string): Promise<VaultFolderRecord | null>;
  listFoldersByVaultId(vaultId: string): Promise<VaultFolderRecord[]>;
  deleteFolder(folderId: string): Promise<void>;
  findItemById(itemId: string): Promise<WorkspaceEncryptedItemRecord | null>;
  updateItem(
    itemId: string,
    data: Partial<WorkspaceEncryptedItemRecord>
  ): Promise<WorkspaceEncryptedItemRecord>;
  deleteItem(itemId: string): Promise<void>;
  createEncryptedFile(data: {
    vaultId: string;
    userId: string;
    itemId: string;
    storageBlobKey: string;
    sizeBytes: number;
    ciphertextSha256Hex: string;
    encryptedMetaBase64: string;
    metaIvBase64: string;
    blobIvBase64: string;
    wrappedFileKeyBase64: string;
    wrappedFileKeyIvBase64: string;
    keyVersion: number;
  }): Promise<EncryptedFileRecord>;
  findEncryptedFileById(fileId: string): Promise<EncryptedFileRecord | null>;
  listEncryptedFilesByItemId(itemId: string): Promise<EncryptedFileRecord[]>;
  deleteEncryptedFile(fileId: string): Promise<void>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
}

/**
 * Client-side helper to encrypt a folder name under the Vault Master Key's
 * HKDF folder subkey ("dusk-v1-folder-key").
 */
export async function encryptFolderName(params: {
  folderName: string;
  vaultMasterKeyBase64: string;
  vaultId: string;
  folderResourceId: string;
  keyVersion?: number;
}): Promise<{
  encryptedNameBase64: string;
  nameIvBase64: string;
  keyVersion: number;
}> {
  const trimmed = params.folderName.trim();
  if (!trimmed || trimmed.length > 100) {
    throw new ValidationError("Folder name must be between 1 and 100 characters.");
  }
  const keyVersion = params.keyVersion ?? 1;
  const folderKey = await deriveHkdfSubkey(
    params.vaultMasterKeyBase64,
    "dusk-v1-folder-key",
    keyVersion
  );
  const iv = generateIvBytes();
  const aad = encodeAadContext({
    vaultId: params.vaultId,
    resourceId: params.folderResourceId,
    resourceType: "VAULT_FOLDER",
    keyVersion,
  });

  const encryptedBuf = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(aad),
      tagLength: AES_GCM_TAG_BITS,
    },
    folderKey,
    toArrayBuffer(new TextEncoder().encode(trimmed))
  );

  return {
    encryptedNameBase64: bytesToBase64(new Uint8Array(encryptedBuf)),
    nameIvBase64: bytesToBase64(iv),
    keyVersion,
  };
}

/**
 * Client-side helper to decrypt a folder name using the Vault Master Key.
 */
export async function decryptFolderName(params: {
  encryptedNameBase64: string;
  nameIvBase64: string;
  vaultMasterKeyBase64: string;
  vaultId: string;
  folderResourceId: string;
  keyVersion: number;
}): Promise<string> {
  const iv = base64ToBytes(params.nameIvBase64);
  if (iv.byteLength !== AES_GCM_IV_BYTES) {
    throw new CryptoTamperOrAuthError("Invalid folder name IV.");
  }

  try {
    const folderKey = await deriveHkdfSubkey(
      params.vaultMasterKeyBase64,
      "dusk-v1-folder-key",
      params.keyVersion
    );
    const aad = encodeAadContext({
      vaultId: params.vaultId,
      resourceId: params.folderResourceId,
      resourceType: "VAULT_FOLDER",
      keyVersion: params.keyVersion,
    });
    const decryptedBuf = await globalThis.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(aad),
        tagLength: AES_GCM_TAG_BITS,
      },
      folderKey,
      toArrayBuffer(base64ToBytes(params.encryptedNameBase64))
    );
    return new TextDecoder().decode(decryptedBuf);
  } catch {
    throw new CryptoTamperOrAuthError("Failed to decrypt folder name.");
  }
}

/**
 * Client-side local search and filter over already-decrypted vault items in browser memory.
 * Never transmits search queries, tags, or titles to the server.
 */
export function filterDecryptedVaultItems<
  T extends {
    id: string;
    folderId: string | null;
    isFavorite: boolean;
    sortOrder: number;
    decrypted: TypedVaultItemPlaintext;
  }
>(
  items: T[],
  filter: {
    query?: string;
    category?: ItemCategory | "ALL";
    folderId?: string | "ALL";
    tag?: string;
    favoritesOnly?: boolean;
  }
): T[] {
  const normalizedQuery = filter.query?.trim().toLowerCase() ?? "";
  const normalizedTag = filter.tag?.trim().toLowerCase() ?? "";

  return items
    .filter((item) => {
      if (filter.favoritesOnly && !item.isFavorite) return false;
      if (
        filter.category &&
        filter.category !== "ALL" &&
        item.decrypted.category !== filter.category
      ) {
        return false;
      }
      if (
        filter.folderId &&
        filter.folderId !== "ALL" &&
        item.folderId !== filter.folderId
      ) {
        return false;
      }
      if (normalizedTag) {
        const hasTag = item.decrypted.tags.some(
          (t) => t.toLowerCase() === normalizedTag
        );
        if (!hasTag) return false;
      }
      if (normalizedQuery) {
        const matchesTitle = item.decrypted.title
          .toLowerCase()
          .includes(normalizedQuery);
        const matchesTag = item.decrypted.tags.some((t) =>
          t.toLowerCase().includes(normalizedQuery)
        );
        if (!matchesTitle && !matchesTag) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      return a.sortOrder - b.sortOrder;
    });
}

export class VaultWorkspaceService {
  constructor(private readonly store: VaultWorkspacePersistencePort) {}

  /**
   * Creates an encrypted folder inside the user's vault.
   */
  async createEncryptedFolder(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<VaultFolderRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);

    const parsed = CreateEncryptedFolderInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid encrypted folder input."
      );
    }
    const input = parsed.data;

    const vault = assertResourceOwnership(
      await this.store.findVaultById(input.vaultId),
      authenticatedUserId,
      "Vault"
    );

    const folder = await this.store.createFolder({
      vaultId: vault.id,
      userId: authenticatedUserId,
      encryptedNameBase64: input.encryptedNameBase64,
      nameIvBase64: input.nameIvBase64,
      keyVersion: input.keyVersion,
      sortOrder: input.sortOrder,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "VAULT_FOLDER_CREATED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        vaultId: vault.id,
        folderId: folder.id,
      }),
    });

    return folder;
  }

  /**
   * Updates an encrypted vault item (e.g., moving between folders, toggling favorite,
   * updating sort order, or replacing the encrypted payload envelope).
   * Rejects any plaintext secrets at the boundary.
   */
  async updateEncryptedItem(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<WorkspaceEncryptedItemRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);

    const parsed = UpdateEncryptedItemEnvelopeInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid item update parameters."
      );
    }
    const input = parsed.data;

    const item = assertResourceOwnership(
      await this.store.findItemById(input.itemId),
      authenticatedUserId,
      "EncryptedItem"
    );

    if (input.folderId) {
      const folder = assertResourceOwnership(
        await this.store.findFolderById(input.folderId),
        authenticatedUserId,
        "VaultFolder"
      );
      if (folder.vaultId !== item.vaultId) {
        throw new ValidationError("Target folder belongs to a different vault.");
      }
    }

    const updated = await this.store.updateItem(item.id, {
      folderId:
        input.folderId !== undefined ? input.folderId : item.folderId,
      category: input.category ?? item.category,
      isFavorite: input.isFavorite ?? item.isFavorite,
      sortOrder: input.sortOrder ?? item.sortOrder,
      ciphertextBase64: input.ciphertextBase64 ?? item.ciphertextBase64,
      ivBase64: input.ivBase64 ?? item.ivBase64,
      wrappedItemKeyBase64:
        input.wrappedItemKeyBase64 ?? item.wrappedItemKeyBase64,
      wrappedItemKeyIvBase64:
        input.wrappedItemKeyIvBase64 ?? item.wrappedItemKeyIvBase64,
      keyVersion: input.keyVersion ?? item.keyVersion,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "VAULT_ITEM_UPDATED",
      severity: "INFO",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          itemId: updated.id,
          folderId: updated.folderId,
          isFavorite: updated.isFavorite,
          ciphertextBase64: updated.ciphertextBase64,
        })
      ),
    });

    return updated;
  }

  /**
   * Registers an encrypted file attachment metadata record after the client has
   * encrypted the file blob and metadata locally.
   */
  async attachEncryptedFileToItem(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<EncryptedFileRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);

    // Also block unencrypted `fileName` or `rawFileBytes` from ever being sent to server metadata
    if (
      typeof rawInput === "object" &&
      rawInput !== null &&
      ("fileName" in (rawInput as Record<string, unknown>) ||
        "plaintextFile" in (rawInput as Record<string, unknown>))
    ) {
      throw new ValidationError(
        "Zero-knowledge violation: unencrypted fileName or file contents must not be sent to the server."
      );
    }

    const parsed = UploadEncryptedFileInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid encrypted file metadata."
      );
    }
    const input = parsed.data;

    const item = assertResourceOwnership(
      await this.store.findItemById(input.itemId),
      authenticatedUserId,
      "EncryptedItem"
    );

    if (item.vaultId !== input.vaultId) {
      throw new ValidationError("Item does not belong to specified vault.");
    }

    const fileRecord = await this.store.createEncryptedFile({
      vaultId: item.vaultId,
      userId: authenticatedUserId,
      itemId: item.id,
      storageBlobKey: input.storageBlobKey,
      sizeBytes: input.sizeBytes,
      ciphertextSha256Hex: input.ciphertextSha256Hex,
      encryptedMetaBase64: input.encryptedMetaBase64,
      metaIvBase64: input.metaIvBase64,
      blobIvBase64: input.blobIvBase64,
      wrappedFileKeyBase64: input.wrappedFileKeyBase64,
      wrappedFileKeyIvBase64: input.wrappedFileKeyIvBase64,
      keyVersion: input.keyVersion,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "ENCRYPTED_FILE_ATTACHED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        fileId: fileRecord.id,
        itemId: item.id,
        sizeBytes: fileRecord.sizeBytes,
        ciphertextSha256Hex: fileRecord.ciphertextSha256Hex,
      }),
    });

    return fileRecord;
  }

  /**
   * Replaces an existing encrypted file attachment by deleting the old record and
   * registering the new encrypted blob + integrity hash.
   */
  async replaceEncryptedFileAttachment(
    authenticatedUserId: string | null | undefined,
    oldFileId: string,
    newFileInput: unknown
  ): Promise<{ deletedFileId: string; newFile: EncryptedFileRecord }> {
    const existing = assertResourceOwnership(
      await this.store.findEncryptedFileById(oldFileId),
      authenticatedUserId,
      "EncryptedFile"
    );

    const newFile = await this.attachEncryptedFileToItem(
      authenticatedUserId,
      newFileInput
    );
    await this.store.deleteEncryptedFile(existing.id);

    await this.store.appendAuditEvent({
      userId: existing.userId,
      eventType: "ENCRYPTED_FILE_REPLACED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        deletedFileId: existing.id,
        newFileId: newFile.id,
      }),
    });

    return { deletedFileId: existing.id, newFile };
  }

  /**
   * Deletes an encrypted file attachment owned by the user.
   */
  async deleteEncryptedFileAttachment(
    authenticatedUserId: string | null | undefined,
    fileId: string
  ): Promise<void> {
    const existing = assertResourceOwnership(
      await this.store.findEncryptedFileById(fileId),
      authenticatedUserId,
      "EncryptedFile"
    );

    await this.store.deleteEncryptedFile(existing.id);

    await this.store.appendAuditEvent({
      userId: existing.userId,
      eventType: "ENCRYPTED_FILE_DELETED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        fileId: existing.id,
        itemId: existing.itemId,
      }),
    });
  }
}

export {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  CRYPTO_SCHEMA_VERSION,
};