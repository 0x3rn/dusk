// lib/services/selective-release-service.ts
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
  canReceiveReleasePackage,
  type ContactRecord,
} from "./contact-service";
import type { EncryptedItemRecord } from "./foundation-service";

export const AssignItemToBeneficiaryInputSchema = z.object({
  contactId: z.string().min(1),
  itemId: z.string().min(1),
  folderId: z.string().optional(),
  beneficiaryWrappedKeyBase64: z.string().min(24),
  beneficiaryWrappedKeyIv: z.string().min(16),
  ephemeralPublicKeyBase64: z.string().min(32),
  keyVersion: z.number().int().positive().default(1),
});

export interface ReleaseAssignmentRecord {
  id: string;
  userId: string;
  contactId: string;
  itemId: string;
  folderId: string | null;
  beneficiaryWrappedKeyBase64: string;
  beneficiaryWrappedKeyIv: string;
  ephemeralPublicKeyBase64: string;
  keyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScopedBeneficiaryReleasePackage {
  beneficiaryContactId: string;
  beneficiaryEmail: string;
  vaultOwnerUserId: string;
  generatedAtIso: string;
  items: Array<{
    itemId: string;
    folderId: string | null;
    category: EncryptedItemRecord["category"];
    schemaVersion: number;
    keyVersion: number;
    ciphertextBase64: string;
    ivBase64: string;
    aadResourceId: string;
    wrappedGrant: {
      beneficiaryWrappedKeyBase64: string;
      beneficiaryWrappedKeyIv: string;
      ephemeralPublicKeyBase64: string;
      keyVersion: number;
    };
  }>;
}

export interface SelectiveReleasePersistencePort {
  findContactById(contactId: string): Promise<ContactRecord | null>;
  findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null>;
  listEncryptedItemsByFolderId(
    userId: string,
    folderId: string
  ): Promise<EncryptedItemRecord[]>;
  upsertReleaseAssignment(data: {
    userId: string;
    contactId: string;
    itemId: string;
    folderId: string | null;
    beneficiaryWrappedKeyBase64: string;
    beneficiaryWrappedKeyIv: string;
    ephemeralPublicKeyBase64: string;
    keyVersion: number;
  }): Promise<ReleaseAssignmentRecord>;
  deleteReleaseAssignment(contactId: string, itemId: string): Promise<boolean>;
  listAssignmentsByContactId(contactId: string): Promise<ReleaseAssignmentRecord[]>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class SelectiveReleaseService {
  constructor(private readonly store: SelectiveReleasePersistencePort) {}

  /**
   * Assigns (or re-wraps) a specific encrypted vault item to a verified Beneficiary.
   * Enforces:
   * 1. Zero-knowledge payload check (no raw item keys or master keys).
   * 2. Ownership of both the Contact and the EncryptedItem.
   * 3. The Contact is a verified Beneficiary with a registered public key (`canReceiveReleasePackage`).
   */
  async assignItemToBeneficiary(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<ReleaseAssignmentRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);

    const parsed = AssignItemToBeneficiaryInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid release assignment input."
      );
    }
    const input = parsed.data;

    const contact = assertResourceOwnership(
      await this.store.findContactById(input.contactId),
      authenticatedUserId,
      "Contact"
    );

    if (!canReceiveReleasePackage(contact)) {
      throw new ValidationError(
        "Target contact is not an active, verified Beneficiary with a registered public key."
      );
    }

    const item = assertResourceOwnership(
      await this.store.findEncryptedItemById(input.itemId),
      authenticatedUserId,
      "EncryptedItem"
    );

    if (item.keyVersion !== input.keyVersion) {
      throw new ValidationError(
        `Assignment keyVersion (${input.keyVersion}) must match item keyVersion (${item.keyVersion}).`
      );
    }

    const assignment = await this.store.upsertReleaseAssignment({
      userId: authenticatedUserId,
      contactId: contact.id,
      itemId: item.id,
      folderId: input.folderId ?? item.folderId ?? null,
      beneficiaryWrappedKeyBase64: input.beneficiaryWrappedKeyBase64,
      beneficiaryWrappedKeyIv: input.beneficiaryWrappedKeyIv,
      ephemeralPublicKeyBase64: input.ephemeralPublicKeyBase64,
      keyVersion: input.keyVersion,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "BENEFICIARY_ITEM_ASSIGNED",
      severity: "INFO",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          contactId: contact.id,
          itemId: item.id,
          keyVersion: input.keyVersion,
          wrappedKeyBase64: input.beneficiaryWrappedKeyBase64,
        })
      ),
    });

    return assignment;
  }

  /**
   * Batch-assigns all items inside a folder to a verified Beneficiary.
   */
  async assignFolderItemsToBeneficiary(
    authenticatedUserId: string | null | undefined,
    params: {
      contactId: string;
      folderId: string;
      wrappedItems: Array<{
        itemId: string;
        beneficiaryWrappedKeyBase64: string;
        beneficiaryWrappedKeyIv: string;
        ephemeralPublicKeyBase64: string;
        keyVersion: number;
      }>;
    }
  ): Promise<ReleaseAssignmentRecord[]> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const folderItems = await this.store.listEncryptedItemsByFolderId(
      authenticatedUserId,
      params.folderId
    );
    const folderItemIds = new Set(folderItems.map((i) => i.id));

    const results: ReleaseAssignmentRecord[] = [];
    for (const entry of params.wrappedItems) {
      if (!folderItemIds.has(entry.itemId)) {
        throw new ValidationError(
          `Item ${entry.itemId} does not belong to folder ${params.folderId}.`
        );
      }
      const assigned = await this.assignItemToBeneficiary(authenticatedUserId, {
        contactId: params.contactId,
        itemId: entry.itemId,
        folderId: params.folderId,
        beneficiaryWrappedKeyBase64: entry.beneficiaryWrappedKeyBase64,
        beneficiaryWrappedKeyIv: entry.beneficiaryWrappedKeyIv,
        ephemeralPublicKeyBase64: entry.ephemeralPublicKeyBase64,
        keyVersion: entry.keyVersion,
      });
      results.push(assigned);
    }

    return results;
  }

  /**
   * Unassigns an item from a Beneficiary and deletes their wrapped key grant
   * so prior unreleased package material is immediately invalidated.
   */
  async unassignItemFromBeneficiary(
    authenticatedUserId: string | null | undefined,
    contactId: string,
    itemId: string
  ): Promise<void> {
    const contact = assertResourceOwnership(
      await this.store.findContactById(contactId),
      authenticatedUserId,
      "Contact"
    );

    const deleted = await this.store.deleteReleaseAssignment(contact.id, itemId);
    if (!deleted) {
      throw new ValidationError("Release assignment not found.");
    }

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "BENEFICIARY_ITEM_UNASSIGNED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        itemId,
      }),
    });
  }

  /**
   * Assembles the strictly scoped encrypted release package for a single Beneficiary.
   * Guarantees:
   * - Only items explicitly assigned to `contactId` are included.
   * - The owner's `wrappedItemKeyBase64` (under VMK) is stripped and replaced with
   *   ONLY the `beneficiaryWrappedKeyBase64` for `contactId`.
   * - If an item was rotated to a newer `keyVersion` without re-wrapping for this beneficiary,
   *   it is excluded from the package (preventing stale key mismatches).
   */
  async assembleScopedPackageForBeneficiary(
    userId: string,
    contactId: string
  ): Promise<ScopedBeneficiaryReleasePackage> {
    const contact = assertResourceOwnership(
      await this.store.findContactById(contactId),
      userId,
      "Contact"
    );

    if (!canReceiveReleasePackage(contact)) {
      throw new AuthorizationError(
        "Beneficiary is not verified or is ineligible to receive a release package."
      );
    }

    const assignments = await this.store.listAssignmentsByContactId(contact.id);
    const scopedItems: ScopedBeneficiaryReleasePackage["items"] = [];

    for (const assignment of assignments) {
      const item = await this.store.findEncryptedItemById(assignment.itemId);
      if (!item || item.userId !== userId) {
        continue;
      }
      // Exclude stale assignments if the item's keyVersion was rotated without re-wrapping
      if (item.keyVersion !== assignment.keyVersion) {
        continue;
      }

      scopedItems.push({
        itemId: item.id,
        folderId: item.folderId,
        category: item.category,
        schemaVersion: item.schemaVersion,
        keyVersion: item.keyVersion,
        ciphertextBase64: item.ciphertextBase64,
        ivBase64: item.ivBase64,
        aadResourceId: item.aadResourceId,
        wrappedGrant: {
          beneficiaryWrappedKeyBase64: assignment.beneficiaryWrappedKeyBase64,
          beneficiaryWrappedKeyIv: assignment.beneficiaryWrappedKeyIv,
          ephemeralPublicKeyBase64: assignment.ephemeralPublicKeyBase64,
          keyVersion: assignment.keyVersion,
        },
      });
    }

    return {
      beneficiaryContactId: contact.id,
      beneficiaryEmail: contact.email,
      vaultOwnerUserId: userId,
      generatedAtIso: new Date().toISOString(),
      items: scopedItems,
    };
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };