// lib/services/contact-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthorizationError,
  ContactService,
  CriticalContactChangeWarningError,
  ValidationError,
  canParticipateInReleaseVerification,
  canReceiveReleasePackage,
  type ContactPersistencePort,
  type ContactRecord,
} from "./contact-service";

class InMemoryContactStore implements ContactPersistencePort {
  public contacts = new Map<string, ContactRecord>();
  public assignmentCounts = new Map<string, number>();
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  async findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async findContactByUserAndEmail(userId: string, email: string): Promise<ContactRecord | null> {
    for (const c of this.contacts.values()) {
      if (c.userId === userId && c.email === email) return c;
    }
    return null;
  }

  async findContactByInviteTokenHash(tokenHash: string): Promise<ContactRecord | null> {
    for (const c of this.contacts.values()) {
      if (c.inviteTokenHash === tokenHash) return c;
    }
    return null;
  }

  async listContactsByUserId(userId: string): Promise<ContactRecord[]> {
    return Array.from(this.contacts.values()).filter((c) => c.userId === userId);
  }

  async countReleaseAssignmentsForContact(contactId: string): Promise<number> {
    return this.assignmentCounts.get(contactId) ?? 0;
  }

  async deleteReleaseAssignmentsForContact(contactId: string): Promise<number> {
    const count = this.assignmentCounts.get(contactId) ?? 0;
    this.assignmentCounts.set(contactId, 0);
    return count;
  }

  async createContact(data: {
    userId: string;
    fullName: string;
    email: string;
    phone: string | null;
    isBeneficiary: boolean;
    isTrustedVerifier: boolean;
    status: ContactRecord["status"];
    inviteTokenHash: string;
    inviteExpiresAt: Date;
  }): Promise<ContactRecord> {
    const now = new Date();
    const record: ContactRecord = {
      id: `cnt_${crypto.randomUUID()}`,
      ...data,
      verifiedAt: null,
      publicKeyBase64: null,
      keyAlgorithm: null,
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.set(record.id, record);
    return record;
  }

  async updateContact(
    contactId: string,
    data: Partial<ContactRecord>
  ): Promise<ContactRecord> {
    const existing = this.contacts.get(contactId);
    if (!existing) throw new Error("Contact not found");
    const updated: ContactRecord = {
      ...existing,
      ...data,
      updatedAt: new Date(),
    };
    this.contacts.set(contactId, updated);
    return updated;
  }

  async deleteContact(contactId: string): Promise<void> {
    this.contacts.delete(contactId);
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

describe("THE-100: Beneficiary & Trusted-Contact Management", () => {
  let store: InMemoryContactStore;
  let service: ContactService;
  const ownerId = "usr_estate_owner";

  beforeEach(() => {
    store = new InMemoryContactStore();
    service = new ContactService(store);
  });

  it("1. enforces distinct Beneficiary vs. Trusted Verifier roles and rejects contacts with neither role", async () => {
    // Rejects contact with neither role
    await expect(
      service.inviteContact(ownerId, {
        fullName: "No Role Person",
        email: "norole@example.com",
        isBeneficiary: false,
        isTrustedVerifier: false,
      })
    ).rejects.toThrowError(ValidationError);

    // 1a. Invite a Recipient-Only Beneficiary
    const benInvite = await service.inviteContact(ownerId, {
      fullName: "Sarah Recipient",
      email: "sarah@example.com",
      isBeneficiary: true,
      isTrustedVerifier: false,
    });

    // Beneficiary must supply publicKeyBase64 on acceptance
    await expect(
      service.acceptContactInvitation({
        rawInviteToken: benInvite.rawInviteToken,
      })
    ).rejects.toThrowError(/must provide a publicKeyBase64/);

    const verifiedBeneficiary = await service.acceptContactInvitation({
      rawInviteToken: benInvite.rawInviteToken,
      publicKeyBase64: Buffer.alloc(32, 5).toString("base64"),
    });

    expect(canReceiveReleasePackage(verifiedBeneficiary)).toBe(true);
    expect(canParticipateInReleaseVerification(verifiedBeneficiary)).toBe(false);

    // 1b. Invite a Verifier-Only Trusted Contact
    const verifierInvite = await service.inviteContact(ownerId, {
      fullName: "Lawyer Verifier",
      email: "lawyer@firm.com",
      isBeneficiary: false,
      isTrustedVerifier: true,
    });

    const verifiedLawyer = await service.acceptContactInvitation({
      rawInviteToken: verifierInvite.rawInviteToken,
    });

    expect(canParticipateInReleaseVerification(verifiedLawyer)).toBe(true);
    expect(canReceiveReleasePackage(verifiedLawyer)).toBe(false);
  });

  it("2. prevents invitation token replay and rejects expired invitations", async () => {
    const now = new Date("2026-10-17T12:00:00Z");
    const invite = await service.inviteContact(
      ownerId,
      {
        fullName: "John Verifier",
        email: "john@example.com",
        isBeneficiary: false,
        isTrustedVerifier: true,
      },
      now
    );

    // Expired 8 days later -> fails
    const eightDaysLater = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    await expect(
      service.acceptContactInvitation(
        { rawInviteToken: invite.rawInviteToken },
        eightDaysLater
      )
    ).rejects.toThrowError(/expired/);

    // Re-invite rotates token
    const reinvited = await service.reinviteContact(
      ownerId,
      invite.contact.id,
      eightDaysLater
    );
    expect(reinvited.rawInviteToken).not.toBe(invite.rawInviteToken);

    // Accept valid new token
    const accepted = await service.acceptContactInvitation(
      { rawInviteToken: reinvited.rawInviteToken },
      new Date(eightDaysLater.getTime() + 1000)
    );
    expect(accepted.status).toBe("VERIFIED");

    // Replaying the same token a second time fails
    await expect(
      service.acceptContactInvitation(
        { rawInviteToken: reinvited.rawInviteToken },
        new Date(eightDaysLater.getTime() + 2000)
      )
    ).rejects.toThrowError(AuthorizationError);
  });

  it("3. requires explicit confirmation before removing the last Trusted Verifier or a Beneficiary with assigned items", async () => {
    const verifierInvite = await service.inviteContact(ownerId, {
      fullName: "Sole Trusted Verifier",
      email: "verifier@example.com",
      isBeneficiary: true,
      isTrustedVerifier: true,
    });

    const verified = await service.acceptContactInvitation({
      rawInviteToken: verifierInvite.rawInviteToken,
      publicKeyBase64: Buffer.alloc(32, 9).toString("base64"),
    });

    // Simulate 2 vault items assigned to this contact
    store.assignmentCounts.set(verified.id, 2);

    // Attempting to revoke without confirmCriticalChange throws CriticalContactChangeWarningError
    try {
      await service.suspendOrRevokeContact(ownerId, {
        contactId: verified.id,
        targetStatus: "REVOKED",
        confirmCriticalChange: false,
      });
      expect.unreachable("Should have required critical confirmation");
    } catch (err) {
      expect(err).toBeInstanceOf(CriticalContactChangeWarningError);
      const warningErr = err as CriticalContactChangeWarningError;
      expect(warningErr.warningReasons).toContain("REMOVING_LAST_TRUSTED_VERIFIER");
      expect(warningErr.warningReasons).toContain("CONTACT_HAS_2_ASSIGNED_RELEASE_ITEMS");
    }

    // With explicit confirmation, revokes contact, clears publicKey, and invalidates assignments
    const { contact: revoked, invalidatedAssignmentsCount } =
      await service.suspendOrRevokeContact(ownerId, {
        contactId: verified.id,
        targetStatus: "REVOKED",
        confirmCriticalChange: true,
      });

    expect(revoked.status).toBe("REVOKED");
    expect(revoked.publicKeyBase64).toBeNull();
    expect(invalidatedAssignmentsCount).toBe(2);
    expect(canParticipateInReleaseVerification(revoked)).toBe(false);
    expect(canReceiveReleasePackage(revoked)).toBe(false);
  });

  it("4. supports replacing a contact and blocks cross-user horizontal access", async () => {
    const invite = await service.inviteContact(ownerId, {
      fullName: "Old Executor",
      email: "old@example.com",
      isBeneficiary: true,
      isTrustedVerifier: false,
    });

    // Another user cannot replace or revoke ownerId's contact
    await expect(
      service.suspendOrRevokeContact("usr_attacker_999", {
        contactId: invite.contact.id,
        targetStatus: "REVOKED",
        confirmCriticalChange: true,
      })
    ).rejects.toThrowError(AuthorizationError);

    const replacement = await service.replaceContact(ownerId, {
      oldContactId: invite.contact.id,
      newFullName: "New Executor",
      newEmail: "new@example.com",
      confirmCriticalChange: true,
    });

    expect(replacement.revokedOldContact.status).toBe("REVOKED");
    expect(replacement.newContact.status).toBe("PENDING_INVITE");
    expect(replacement.newContact.isBeneficiary).toBe(true);
    expect(replacement.newContact.isTrustedVerifier).toBe(false);
  });
});