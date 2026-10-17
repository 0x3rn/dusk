// lib/crypto/beneficiary-wrapping.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  CryptoTamperOrAuthError,
  encryptVaultItemPayload,
  generateRandomKeyBase64,
  rotateEncryptedItemBundle,
} from "./vault-crypto";
import {
  decryptAssignedItemAsBeneficiary,
  generateBeneficiaryKeyPair,
  unwrapItemKeyForBeneficiary,
  wrapItemKeyForBeneficiary,
} from "./beneficiary-wrapping";
import {
  SelectiveReleaseService,
  ValidationError,
  type ReleaseAssignmentRecord,
  type SelectiveReleasePersistencePort,
} from "../services/selective-release-service";
import type { ContactRecord } from "../services/contact-service";
import type { EncryptedItemRecord } from "../services/foundation-service";

class InMemorySelectiveReleaseStore implements SelectiveReleasePersistencePort {
  public contacts = new Map<string, ContactRecord>();
  public items = new Map<string, EncryptedItemRecord>();
  public assignments = new Map<string, ReleaseAssignmentRecord>();
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  async findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null> {
    return this.items.get(itemId) ?? null;
  }

  async listEncryptedItemsByFolderId(
    userId: string,
    folderId: string
  ): Promise<EncryptedItemRecord[]> {
    return Array.from(this.items.values()).filter(
      (i) => i.userId === userId && i.folderId === folderId
    );
  }

  async upsertReleaseAssignment(data: {
    userId: string;
    contactId: string;
    itemId: string;
    folderId: string | null;
    beneficiaryWrappedKeyBase64: string;
    beneficiaryWrappedKeyIv: string;
    ephemeralPublicKeyBase64: string;
    keyVersion: number;
  }): Promise<ReleaseAssignmentRecord> {
    const key = `${data.contactId}:${data.itemId}`;
    const now = new Date();
    const record: ReleaseAssignmentRecord = {
      id: this.assignments.get(key)?.id ?? `asg_${crypto.randomUUID()}`,
      ...data,
      createdAt: this.assignments.get(key)?.createdAt ?? now,
      updatedAt: now,
    };
    this.assignments.set(key, record);
    return record;
  }

  async deleteReleaseAssignment(contactId: string, itemId: string): Promise<boolean> {
    return this.assignments.delete(`${contactId}:${itemId}`);
  }

  async listAssignmentsByContactId(contactId: string): Promise<ReleaseAssignmentRecord[]> {
    return Array.from(this.assignments.values()).filter((a) => a.contactId === contactId);
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

describe("THE-101: Selective Beneficiary Release Packages & Public-Key Wrapping", () => {
  let store: InMemorySelectiveReleaseStore;
  let service: SelectiveReleaseService;
  const ownerId = "usr_vault_owner";
  const vaultId = "vlt_selective_001";

  beforeEach(() => {
    store = new InMemorySelectiveReleaseStore();
    service = new SelectiveReleaseService(store);
  });

  it("1. enforces cryptographic isolation: Beneficiary A and Beneficiary B can only decrypt their own assigned items", async () => {
    const ownerVmk = await generateRandomKeyBase64();

    // Generate distinct ECDH P-256 keypairs for Beneficiary Alice and Beneficiary Bob
    const aliceKeys = await generateBeneficiaryKeyPair();
    const bobKeys = await generateBeneficiaryKeyPair();

    // Encrypt Item 1 (for Alice) and Item 2 (for Bob)
    const { bundle: item1Bundle, itemKeyBase64: item1Key } =
      await encryptVaultItemPayload({
        payload: { title: "Alice Inheritance BTC Wallet", seed: "alice-twelve-words" },
        vaultMasterKeyBase64: ownerVmk,
        vaultId,
        itemId: "itm_alice_only",
      });

    const { bundle: item2Bundle, itemKeyBase64: item2Key } =
      await encryptVaultItemPayload({
        payload: { title: "Bob Inheritance Company Admin", pass: "bob-admin-secret" },
        vaultMasterKeyBase64: ownerVmk,
        vaultId,
        itemId: "itm_bob_only",
      });

    // Wrap Item 1 key to Alice's public key, and Item 2 key to Bob's public key
    const aliceGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: item1Key,
      beneficiaryPublicKeyBase64: aliceKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_alice",
      itemId: "itm_alice_only",
    });

    const bobGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: item2Key,
      beneficiaryPublicKeyBase64: bobKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_bob",
      itemId: "itm_bob_only",
    });

    // Alice decrypts her assigned item without ever having the owner's VMK
    const aliceDecrypted = await decryptAssignedItemAsBeneficiary<{
      title: string;
      seed: string;
    }>({
      itemEnvelope: item1Bundle,
      wrappedGrant: aliceGrant,
      beneficiaryPrivateKeyBase64: aliceKeys.privateKeyBase64,
    });
    expect(aliceDecrypted.seed).toBe("alice-twelve-words");

    // Bob decrypts his assigned item
    const bobDecrypted = await decryptAssignedItemAsBeneficiary<{
      title: string;
      pass: string;
    }>({
      itemEnvelope: item2Bundle,
      wrappedGrant: bobGrant,
      beneficiaryPrivateKeyBase64: bobKeys.privateKeyBase64,
    });
    expect(bobDecrypted.pass).toBe("bob-admin-secret");

    // CROSS-BENEFICIARY ATTACK 1: Bob attempts to unwrap Alice's grant with Bob's private key -> FAILS
    await expect(
      unwrapItemKeyForBeneficiary({
        wrappedGrant: aliceGrant,
        beneficiaryPrivateKeyBase64: bobKeys.privateKeyBase64,
      })
    ).rejects.toThrowError(CryptoTamperOrAuthError);

    // CROSS-BENEFICIARY ATTACK 2: Alice attempts to use her valid grant to decrypt Bob's item envelope -> FAILS
    await expect(
      decryptAssignedItemAsBeneficiary({
        itemEnvelope: item2Bundle,
        wrappedGrant: aliceGrant,
        beneficiaryPrivateKeyBase64: aliceKeys.privateKeyBase64,
      })
    ).rejects.toThrowError(CryptoTamperOrAuthError);
  });

  it("2. scopes release packages strictly to assigned items, invalidates unassigned/rotated grants, and blocks non-beneficiaries", async () => {
    const ownerVmk = await generateRandomKeyBase64();
    const aliceKeys = await generateBeneficiaryKeyPair();
    const bobKeys = await generateBeneficiaryKeyPair();

    const now = new Date();
    store.contacts.set("cnt_alice", {
      id: "cnt_alice",
      userId: ownerId,
      fullName: "Alice Beneficiary",
      email: "alice@example.com",
      phone: null,
      isBeneficiary: true,
      isTrustedVerifier: false,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: aliceKeys.publicKeyBase64,
      keyAlgorithm: aliceKeys.algorithm,
      createdAt: now,
      updatedAt: now,
    });

    store.contacts.set("cnt_bob", {
      id: "cnt_bob",
      userId: ownerId,
      fullName: "Bob Beneficiary",
      email: "bob@example.com",
      phone: null,
      isBeneficiary: true,
      isTrustedVerifier: false,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: bobKeys.publicKeyBase64,
      keyAlgorithm: bobKeys.algorithm,
      createdAt: now,
      updatedAt: now,
    });

    store.contacts.set("cnt_verifier_only", {
      id: "cnt_verifier_only",
      userId: ownerId,
      fullName: "Verifier Only",
      email: "verifier@example.com",
      phone: null,
      isBeneficiary: false,
      isTrustedVerifier: true,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: null,
      keyAlgorithm: null,
      createdAt: now,
      updatedAt: now,
    });

    // Create 3 encrypted items in the vault (Item 1 for Alice, Item 2 for Bob, Item 3 Private/Unassigned)
    const item1 = await encryptVaultItemPayload({
      payload: { secret: "alice-secret-1" },
      vaultMasterKeyBase64: ownerVmk,
      vaultId,
      itemId: "itm_1",
    });
    const item2 = await encryptVaultItemPayload({
      payload: { secret: "bob-secret-2" },
      vaultMasterKeyBase64: ownerVmk,
      vaultId,
      itemId: "itm_2",
    });
    const item3 = await encryptVaultItemPayload({
      payload: { secret: "unassigned-secret-3" },
      vaultMasterKeyBase64: ownerVmk,
      vaultId,
      itemId: "itm_3",
    });

    for (const [id, enc] of [
      ["itm_1", item1],
      ["itm_2", item2],
      ["itm_3", item3],
    ] as const) {
      store.items.set(id, {
        id,
        vaultId,
        userId: ownerId,
        folderId: "fld_main",
        category: "CRYPTO_RECOVERY",
        schemaVersion: 1,
        keyVersion: enc.bundle.keyVersion,
        ciphertextBase64: enc.bundle.ciphertextBase64,
        ivBase64: enc.bundle.ivBase64,
        wrappedItemKeyBase64: enc.bundle.wrappedItemKeyBase64,
        wrappedItemKeyIvBase64: enc.bundle.wrappedItemKeyIvBase64,
        aadResourceId: id,
        createdAt: now,
      });
    }

    // Cannot assign an item to a Verifier-Only contact
    const fakeGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: item1.itemKeyBase64,
      beneficiaryPublicKeyBase64: aliceKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_verifier_only",
      itemId: "itm_1",
    });
    await expect(
      service.assignItemToBeneficiary(ownerId, fakeGrant)
    ).rejects.toThrowError(ValidationError);

    // Assign Item 1 to Alice and Item 2 to Bob
    const aliceGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: item1.itemKeyBase64,
      beneficiaryPublicKeyBase64: aliceKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_alice",
      itemId: "itm_1",
    });
    await service.assignItemToBeneficiary(ownerId, aliceGrant);

    const bobGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: item2.itemKeyBase64,
      beneficiaryPublicKeyBase64: bobKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_bob",
      itemId: "itm_2",
    });
    await service.assignItemToBeneficiary(ownerId, bobGrant);

    // Assemble Alice's package: contains ONLY itm_1 (never itm_2 or itm_3)
    const alicePkg = await service.assembleScopedPackageForBeneficiary(
      ownerId,
      "cnt_alice"
    );
    expect(alicePkg.items).toHaveLength(1);
    expect(alicePkg.items[0].itemId).toBe("itm_1");

    // Unassign Item 1 from Alice -> Alice's package is now empty
    await service.unassignItemFromBeneficiary(ownerId, "cnt_alice", "itm_1");
    const aliceAfterUnassign = await service.assembleScopedPackageForBeneficiary(
      ownerId,
      "cnt_alice"
    );
    expect(aliceAfterUnassign.items).toHaveLength(0);

    // Rotate Item 2 to keyVersion 2 without re-wrapping for Bob -> stale v1 assignment is excluded
    const newOwnerVmk = await generateRandomKeyBase64();
    const rotatedItem2 = await rotateEncryptedItemBundle({
      bundle: item2.bundle,
      oldVaultMasterKeyBase64: ownerVmk,
      newVaultMasterKeyBase64: newOwnerVmk,
      newKeyVersion: 2,
    });
    store.items.set("itm_2", {
      ...store.items.get("itm_2")!,
      keyVersion: 2,
      ciphertextBase64: rotatedItem2.ciphertextBase64,
      ivBase64: rotatedItem2.ivBase64,
      wrappedItemKeyBase64: rotatedItem2.wrappedItemKeyBase64,
      wrappedItemKeyIvBase64: rotatedItem2.wrappedItemKeyIvBase64,
    });

    const bobPkgWithStaleKey = await service.assembleScopedPackageForBeneficiary(
      ownerId,
      "cnt_bob"
    );
    expect(bobPkgWithStaleKey.items).toHaveLength(0);
  });
});