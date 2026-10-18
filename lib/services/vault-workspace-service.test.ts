// lib/services/vault-workspace-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  TypedVaultItemPlaintextSchema,
  VaultWorkspaceService,
  ValidationError,
  decryptFolderName,
  encryptFolderName,
  filterDecryptedVaultItems,
  type EncryptedFileRecord,
  type VaultFolderRecord,
  type VaultWorkspacePersistencePort,
  type WorkspaceEncryptedItemRecord,
} from "./vault-workspace-service";
import {
  CryptoTamperOrAuthError,
  decryptVaultFileAttachment,
  decryptVaultItemPayload,
  encryptVaultFileAttachment,
  encryptVaultItemPayload,
  generateRandomKeyBase64,
} from "../crypto/vault-crypto";

class InMemoryVaultWorkspaceStore implements VaultWorkspacePersistencePort {
  public vaults = new Map<string, { id: string; userId: string }>();
  public folders = new Map<string, VaultFolderRecord>();
  public items = new Map<string, WorkspaceEncryptedItemRecord>();
  public files = new Map<string, EncryptedFileRecord>();
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  async findVaultById(vaultId: string) {
    return this.vaults.get(vaultId) ?? null;
  }

  async createFolder(data: {
    vaultId: string;
    userId: string;
    encryptedNameBase64: string;
    nameIvBase64: string;
    keyVersion: number;
    sortOrder: number;
  }): Promise<VaultFolderRecord> {
    const now = new Date();
    const rec: VaultFolderRecord = {
      id: `fld_${crypto.randomUUID()}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.folders.set(rec.id, rec);
    return rec;
  }

  async findFolderById(folderId: string): Promise<VaultFolderRecord | null> {
    return this.folders.get(folderId) ?? null;
  }

  async listFoldersByVaultId(vaultId: string): Promise<VaultFolderRecord[]> {
    return Array.from(this.folders.values()).filter((f) => f.vaultId === vaultId);
  }

  async deleteFolder(folderId: string): Promise<void> {
    this.folders.delete(folderId);
  }

  async findItemById(itemId: string): Promise<WorkspaceEncryptedItemRecord | null> {
    return this.items.get(itemId) ?? null;
  }

  async updateItem(
    itemId: string,
    data: Partial<WorkspaceEncryptedItemRecord>
  ): Promise<WorkspaceEncryptedItemRecord> {
    const existing = this.items.get(itemId)!;
    const updated: WorkspaceEncryptedItemRecord = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.items.set(itemId, updated);
    return updated;
  }

  async deleteItem(itemId: string): Promise<void> {
    this.items.delete(itemId);
  }

  async createEncryptedFile(data: {
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
  }): Promise<EncryptedFileRecord> {
    const rec: EncryptedFileRecord = {
      id: `fil_${crypto.randomUUID()}`,
      ...data,
      createdAt: new Date(),
    };
    this.files.set(rec.id, rec);
    return rec;
  }

  async findEncryptedFileById(fileId: string): Promise<EncryptedFileRecord | null> {
    return this.files.get(fileId) ?? null;
  }

  async listEncryptedFilesByItemId(itemId: string): Promise<EncryptedFileRecord[]> {
    return Array.from(this.files.values()).filter((f) => f.itemId === itemId);
  }

  async deleteEncryptedFile(fileId: string): Promise<void> {
    this.files.delete(fileId);
  }

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void> {
    this.audits.push(data);
  }
}

describe("THE-106: Encrypted Vault Items, Folders, Search & File Attachments", () => {
  let store: InMemoryVaultWorkspaceStore;
  let service: VaultWorkspaceService;
  const userId = "usr_workspace_owner";
  const vaultId = "vlt_workspace_001";

  beforeEach(() => {
    store = new InMemoryVaultWorkspaceStore();
    store.vaults.set(vaultId, { id: vaultId, userId });
    service = new VaultWorkspaceService(store);
  });

  it("1. validates and encrypts all 7 typed vault item schemas on the client without exposing plaintext to the server", async () => {
    const vmk = await generateRandomKeyBase64();

    const sampleItems = [
      {
        category: "CREDENTIAL" as const,
        title: "ProtonMail Master Account",
        tags: ["email", "critical"],
        serviceUrl: "https://mail.proton.me",
        username: "satoshi@proton.me",
        password: "super-secret-proton-password",
        totpOrBackupCodes: "1122-3344, 5566-7788",
      },
      {
        category: "CRYPTO_RECOVERY" as const,
        title: "Ledger Multisig Vault",
        tags: ["bitcoin", "multisig"],
        walletType: "Ledger Nano X",
        networkOrChain: "Bitcoin Mainnet",
        seedPhraseOrPrivateKey: "witch collapse practice feed shame open despair",
        derivationPathOrPassphrase: "m/84'/0'/0'",
      },
      {
        category: "DEVICE_ACCESS" as const,
        title: "MacBook Pro FileVault",
        tags: ["hardware", "apple"],
        deviceName: "M4 MacBook Pro",
        pinOrPasscode: "998877",
        diskRecoveryKey: "ABCD-1234-EFGH-5678",
      },
      {
        category: "FINANCIAL_INSTRUCTION" as const,
        title: "Fidelity Brokerage & Trust",
        tags: ["finance", "brokerage"],
        institutionName: "Fidelity Investments",
        accountOrPolicyIdentifier: "Z99-887766",
        instructions: "Contact estate specialist Jane Smith.",
      },
      {
        category: "DOCUMENT" as const,
        title: "Original Living Trust Deed",
        tags: ["legal", "trust"],
        documentType: "Revocable Living Trust",
        physicalOrCloudLocation: "Fireproof Safe in Home Office",
        summaryAndInstructions: "Combination is in Device Access folder.",
      },
      {
        category: "FINAL_WISH" as const,
        title: "Letter to My Family",
        tags: ["family", "wishes"],
        intendedRecipientNote: "Sarah & John",
        messageBody: "Thank you for everything...",
      },
      {
        category: "SECURE_NOTE" as const,
        title: "Server Rack Maintenance Notes",
        tags: ["infra"],
        content: "SSH keys are stored on the YubiKey 5C Nano.",
      },
    ];

    for (const rawItem of sampleItems) {
      const validated = TypedVaultItemPlaintextSchema.parse(rawItem);
      const { bundle } = await encryptVaultItemPayload({
        payload: validated,
        vaultMasterKeyBase64: vmk,
        vaultId,
        itemId: `itm_${validated.category}`,
      });

      // Ciphertext stored on server never contains plaintext title or secrets
      expect(bundle.ciphertextBase64).not.toContain(validated.title);

      const { payload: decrypted } = await decryptVaultItemPayload({
        bundle,
        vaultMasterKeyBase64: vmk,
      });
      expect(decrypted).toEqual(validated);
    }
  });

  it("2. encrypts folder names, moves items across folders, and filters/searches decrypted items locally", async () => {
    const vmk = await generateRandomKeyBase64();

    const encryptedFolder = await encryptFolderName({
      folderName: "Hardware Wallets & Cold Storage",
      vaultMasterKeyBase64: vmk,
      vaultId,
      folderResourceId: "fld_crypto_1",
    });

    const folder = await service.createEncryptedFolder(userId, {
      vaultId,
      encryptedNameBase64: encryptedFolder.encryptedNameBase64,
      nameIvBase64: encryptedFolder.nameIvBase64,
      keyVersion: encryptedFolder.keyVersion,
      sortOrder: 1,
    });

    const decryptedFolderTitle = await decryptFolderName({
      encryptedNameBase64: folder.encryptedNameBase64,
      nameIvBase64: folder.nameIvBase64,
      vaultMasterKeyBase64: vmk,
      vaultId,
      folderResourceId: "fld_crypto_1",
      keyVersion: folder.keyVersion,
    });
    expect(decryptedFolderTitle).toBe("Hardware Wallets & Cold Storage");

    // Seed an item and move it into the folder + mark as favorite
    const now = new Date();
    store.items.set("itm_1", {
      id: "itm_1",
      vaultId,
      userId,
      folderId: null,
      category: "CRYPTO_RECOVERY",
      isFavorite: false,
      sortOrder: 0,
      schemaVersion: 1,
      keyVersion: 1,
      ciphertextBase64: Buffer.alloc(32, 1).toString("base64"),
      ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
      wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "itm_1",
      createdAt: now,
      updatedAt: now,
    });

    const moved = await service.updateEncryptedItem(userId, {
      itemId: "itm_1",
      folderId: folder.id,
      isFavorite: true,
    });
    expect(moved.folderId).toBe(folder.id);
    expect(moved.isFavorite).toBe(true);

    // Local decrypted search & filtering
    const localItems = [
      {
        id: "itm_1",
        folderId: folder.id,
        isFavorite: true,
        sortOrder: 1,
        decrypted: TypedVaultItemPlaintextSchema.parse({
          category: "CRYPTO_RECOVERY",
          title: "Coldcard Mk4 Backup",
          tags: ["bitcoin", "coldcard"],
          walletType: "Coldcard",
          seedPhraseOrPrivateKey: "seed-1",
        }),
      },
      {
        id: "itm_2",
        folderId: null,
        isFavorite: false,
        sortOrder: 0,
        decrypted: TypedVaultItemPlaintextSchema.parse({
          category: "CREDENTIAL",
          title: "Cloudflare Registrar",
          tags: ["domains", "dns"],
          username: "admin@dusk.app",
          password: "pw",
        }),
      },
    ];

    expect(
      filterDecryptedVaultItems(localItems, { query: "coldcard" })
    ).toHaveLength(1);
    expect(filterDecryptedVaultItems(localItems, { tag: "dns" })).toHaveLength(1);
    expect(
      filterDecryptedVaultItems(localItems, { favoritesOnly: true })[0].id
    ).toBe("itm_1");
  });

  it("3. attaches, replaces, deletes, and verifies integrity of encrypted file attachments", async () => {
    const vmk = await generateRandomKeyBase64();
    const now = new Date();
    store.items.set("itm_doc_1", {
      id: "itm_doc_1",
      vaultId,
      userId,
      folderId: null,
      category: "DOCUMENT",
      isFavorite: false,
      sortOrder: 0,
      schemaVersion: 1,
      keyVersion: 1,
      ciphertextBase64: Buffer.alloc(32, 1).toString("base64"),
      ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
      wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "itm_doc_1",
      createdAt: now,
      updatedAt: now,
    });

    const fileBytesV1 = new TextEncoder().encode("Deed of Trust v1 PDF binary");
    const encFileV1 = await encryptVaultFileAttachment({
      fileBytes: fileBytesV1,
      metadata: {
        fileName: "trust-deed-v1.pdf",
        mimeType: "application/pdf",
        sizeBytes: fileBytesV1.byteLength,
      },
      vaultMasterKeyBase64: vmk,
      vaultId,
      fileId: "fil_v1",
    });

    // Rejects if caller tries to send plaintext `fileName` to the server
    await expect(
      service.attachEncryptedFileToItem(userId, {
        vaultId,
        itemId: "itm_doc_1",
        fileName: "trust-deed-v1.pdf",
        storageBlobKey: "blobs/uuid-1",
        sizeBytes: encFileV1.encryptedBlob.byteLength,
        ciphertextSha256Hex: encFileV1.ciphertextSha256Hex,
        encryptedMetaBase64: encFileV1.encryptedMetaBase64,
        metaIvBase64: encFileV1.metaIvBase64,
        blobIvBase64: encFileV1.blobIvBase64,
        wrappedFileKeyBase64: encFileV1.wrappedFileKeyBase64,
        wrappedFileKeyIvBase64: encFileV1.wrappedFileKeyIvBase64,
      })
    ).rejects.toThrowError(ValidationError);

    // Valid encrypted attachment registration
    const savedFileV1 = await service.attachEncryptedFileToItem(userId, {
      vaultId,
      itemId: "itm_doc_1",
      storageBlobKey: "blobs/uuid-v1",
      sizeBytes: encFileV1.encryptedBlob.byteLength,
      ciphertextSha256Hex: encFileV1.ciphertextSha256Hex,
      encryptedMetaBase64: encFileV1.encryptedMetaBase64,
      metaIvBase64: encFileV1.metaIvBase64,
      blobIvBase64: encFileV1.blobIvBase64,
      wrappedFileKeyBase64: encFileV1.wrappedFileKeyBase64,
      wrappedFileKeyIvBase64: encFileV1.wrappedFileKeyIvBase64,
      keyVersion: 1,
    });

    // Replace attachment with v2
    const fileBytesV2 = new TextEncoder().encode("Deed of Trust v2 Updated PDF");
    const encFileV2 = await encryptVaultFileAttachment({
      fileBytes: fileBytesV2,
      metadata: {
        fileName: "trust-deed-v2.pdf",
        mimeType: "application/pdf",
        sizeBytes: fileBytesV2.byteLength,
      },
      vaultMasterKeyBase64: vmk,
      vaultId,
      fileId: "fil_v2",
    });

    const replaced = await service.replaceEncryptedFileAttachment(
      userId,
      savedFileV1.id,
      {
        vaultId,
        itemId: "itm_doc_1",
        storageBlobKey: "blobs/uuid-v2",
        sizeBytes: encFileV2.encryptedBlob.byteLength,
        ciphertextSha256Hex: encFileV2.ciphertextSha256Hex,
        encryptedMetaBase64: encFileV2.encryptedMetaBase64,
        metaIvBase64: encFileV2.metaIvBase64,
        blobIvBase64: encFileV2.blobIvBase64,
        wrappedFileKeyBase64: encFileV2.wrappedFileKeyBase64,
        wrappedFileKeyIvBase64: encFileV2.wrappedFileKeyIvBase64,
        keyVersion: 1,
      }
    );

    expect(await store.findEncryptedFileById(savedFileV1.id)).toBeNull();
    expect(replaced.newFile.storageBlobKey).toBe("blobs/uuid-v2");

    // Corrupting 1 byte of the downloaded encrypted blob is caught during decryption
    const corruptedBlob = new Uint8Array(encFileV2.encryptedBlob);
    corruptedBlob[0] ^= 0xff;
    await expect(
      decryptVaultFileAttachment({
        bundle: { ...encFileV2, encryptedBlob: corruptedBlob },
        vaultMasterKeyBase64: vmk,
      })
    ).rejects.toThrowError(CryptoTamperOrAuthError);

    // Delete attachment
    await service.deleteEncryptedFileAttachment(userId, replaced.newFile.id);
    expect(await store.findEncryptedFileById(replaced.newFile.id)).toBeNull();
  });
});