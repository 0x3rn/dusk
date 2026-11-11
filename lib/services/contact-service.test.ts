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
  InvitationLinkError,
  type ContactAuditEntry,
  type ContactPersistencePort,
  type ContactRecord,
} from "./contact-service";

class InMemoryContactStore implements ContactPersistencePort {
  public contacts = new Map<string, ContactRecord>();
  public assignmentCounts = new Map<string, number>();
  public audits: ContactAuditEntry[] = [];
  public ownerNames = new Map<string, string | null>();

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
    publicKeyBase64: string | null;
    keyAlgorithm: string | null;
  }): Promise<ContactRecord> {
    const now = new Date();
    const record: ContactRecord = {
      id: `cnt_${crypto.randomUUID()}`,
      ...data,
      verifiedAt: null,
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

  async findOwnerDisplayName(userId: string): Promise<string | null> {
    return this.ownerNames.get(userId) ?? null;
  }

  private byToken(tokenHash: string): ContactRecord | null {
    for (const c of this.contacts.values()) {
      if (c.inviteTokenHash === tokenHash) return c;
    }
    return null;
  }

  async acceptPendingInvite(args: {
    tokenHash: string;
    now: Date;
    publicKeyBase64: string | null;
    keyAlgorithm: string | null;
  }): Promise<ContactRecord | null> {
    const c = this.byToken(args.tokenHash);
    if (!c || c.status !== "PENDING_INVITE" || !c.inviteExpiresAt || c.inviteExpiresAt <= args.now) return null;
    return this.updateContact(c.id, {
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: args.now,
      publicKeyBase64: args.publicKeyBase64,
      keyAlgorithm: args.keyAlgorithm,
    });
  }

  async declinePendingInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null> {
    const c = this.byToken(args.tokenHash);
    if (!c || c.status !== "PENDING_INVITE" || !c.inviteExpiresAt || c.inviteExpiresAt <= args.now) return null;
    return this.updateContact(c.id, {
      status: "DECLINED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      publicKeyBase64: null,
    });
  }

  async clearExpiredInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null> {
    const c = this.byToken(args.tokenHash);
    if (!c || c.status !== "PENDING_INVITE" || !c.inviteExpiresAt || c.inviteExpiresAt > args.now) return null;
    return this.updateContact(c.id, { inviteTokenHash: null });
  }

  async reissuePendingInvite(args: {
    contactId: string;
    userId: string;
    tokenHash: string;
    inviteExpiresAt: Date;
  }): Promise<ContactRecord | null> {
    const c = this.contacts.get(args.contactId);
    if (!c || c.userId !== args.userId || c.status !== "PENDING_INVITE") return null;
    return this.updateContact(c.id, { inviteTokenHash: args.tokenHash, inviteExpiresAt: args.inviteExpiresAt });
  }

  async appendAuditEvent(data: ContactAuditEntry): Promise<void> {
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

    // 8 days later the 14-day invitation is still valid; 15 days later it has expired.
    const fifteenDaysLater = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
    await expect(
      service.acceptContactInvitation(
        { rawInviteToken: invite.rawInviteToken },
        fifteenDaysLater
      )
    ).rejects.toThrowError(/expired/);

    // Re-invite rotates token
    const reinvited = await service.reinviteContact(
      ownerId,
      invite.contact.id,
      fifteenDaysLater
    );
    expect(reinvited.rawInviteToken).not.toBe(invite.rawInviteToken);

    // Accept valid new token
    const accepted = await service.acceptContactInvitation(
      { rawInviteToken: reinvited.rawInviteToken },
      new Date(fifteenDaysLater.getTime() + 1000)
    );
    expect(accepted.status).toBe("VERIFIED");

    // Replaying the same token a second time fails
    await expect(
      service.acceptContactInvitation(
        { rawInviteToken: reinvited.rawInviteToken },
        new Date(fifteenDaysLater.getTime() + 2000)
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
describe("Invitation flow: nobody takes part until they accept", () => {
  let store: InMemoryContactStore;
  let service: ContactService;
  const ownerId = "usr_owner";
  const key = Buffer.alloc(65, 7).toString("base64");
  const DAY = 24 * 60 * 60 * 1000;
  const t0 = new Date("2026-11-01T10:00:00Z");

  async function invite(overrides: Partial<{ email: string; isBeneficiary: boolean; isTrustedVerifier: boolean }> = {}) {
    return service.inviteContact(
      ownerId,
      {
        fullName: "Ada Lovelace",
        email: overrides.email ?? "ada@example.com",
        isBeneficiary: overrides.isBeneficiary ?? true,
        isTrustedVerifier: overrides.isTrustedVerifier ?? false,
        publicKeyBase64: (overrides.isBeneficiary ?? true) ? key : undefined,
      },
      t0
    );
  }

  beforeEach(() => {
    store = new InMemoryContactStore();
    service = new ContactService(store);
    store.ownerNames.set(ownerId, "Grace Owner");
  });

  it("creates a pending contact with a hashed token that lasts 14 days and keeps the key given at creation", async () => {
    const { contact, rawInviteToken } = await invite({ isTrustedVerifier: true });
    expect(contact.status).toBe("PENDING_INVITE");
    expect(contact.verifiedAt).toBeNull();
    expect(contact.inviteExpiresAt?.getTime()).toBe(t0.getTime() + 14 * DAY);
    expect(contact.publicKeyBase64).toBe(key);
    // Only the hash is stored.
    expect(contact.inviteTokenHash).toBe(crypto.createHash("sha256").update(rawInviteToken).digest("hex"));
    expect(contact.inviteTokenHash).not.toBe(rawInviteToken);
    expect(JSON.stringify(store.audits)).not.toContain(rawInviteToken);
    expect(store.audits.map((a) => a.eventType)).toEqual(["CONTACT_INVITED"]);
  });

  it("does not let a pending, declined, expired or removed contact verify or receive anything", async () => {
    const ben = await invite({ isTrustedVerifier: true });
    // Pending (both roles, with a key): still no.
    expect(canParticipateInReleaseVerification(ben.contact)).toBe(false);
    expect(canReceiveReleasePackage(ben.contact)).toBe(false);

    // Even with a verified-looking date, the status alone keeps them out.
    for (const status of ["PENDING_INVITE", "DECLINED", "SUSPENDED", "REVOKED"] as const) {
      const c = { ...ben.contact, status, verifiedAt: new Date() };
      expect(canParticipateInReleaseVerification(c)).toBe(false);
      expect(canReceiveReleasePackage(c)).toBe(false);
    }

    const accepted = await service.acceptContactInvitation({ rawInviteToken: ben.rawInviteToken }, t0);
    expect(canParticipateInReleaseVerification(accepted)).toBe(true);
    expect(canReceiveReleasePackage(accepted)).toBe(true);
  });

  it("accepts a beneficiary using the key stored at creation, and clears the token", async () => {
    const { rawInviteToken } = await invite();
    const accepted = await service.acceptContactInvitation({ rawInviteToken }, new Date(t0.getTime() + DAY));
    expect(accepted.status).toBe("VERIFIED");
    expect(accepted.publicKeyBase64).toBe(key);
    expect(accepted.inviteTokenHash).toBeNull();
    expect(store.audits.at(-1)).toMatchObject({ eventType: "CONTACT_INVITE_ACCEPTED", actorType: "BENEFICIARY" });
  });

  it("refuses a beneficiary invitation that has no key at all", async () => {
    const { rawInviteToken } = await service.inviteContact(
      ownerId,
      { fullName: "No Key", email: "nokey@example.com", isBeneficiary: true, isTrustedVerifier: false },
      t0
    );
    await expect(service.acceptContactInvitation({ rawInviteToken }, t0)).rejects.toThrowError(ValidationError);
  });

  it("two simultaneous accepts: exactly one succeeds", async () => {
    const { rawInviteToken } = await invite({ isBeneficiary: false, isTrustedVerifier: true });
    const results = await Promise.allSettled([
      service.acceptContactInvitation({ rawInviteToken }, t0),
      service.acceptContactInvitation({ rawInviteToken }, t0),
      service.acceptContactInvitation({ rawInviteToken }, t0),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(2);
    for (const r of rejected) expect(r.reason).toBeInstanceOf(InvitationLinkError);
    expect(store.audits.filter((a) => a.eventType === "CONTACT_INVITE_ACCEPTED")).toHaveLength(1);
  });

  it("declining ends the invitation: replay fails, nothing can be accepted, the key is dropped", async () => {
    const { rawInviteToken, contact } = await invite();
    const declined = await service.declineContactInvitation({ rawInviteToken }, t0);
    expect(declined.status).toBe("DECLINED");
    expect(declined.publicKeyBase64).toBeNull();
    expect(canReceiveReleasePackage(declined)).toBe(false);
    expect(store.audits.at(-1)).toMatchObject({ eventType: "CONTACT_INVITE_DECLINED" });

    await expect(service.acceptContactInvitation({ rawInviteToken }, t0)).rejects.toThrowError(InvitationLinkError);
    await expect(service.declineContactInvitation({ rawInviteToken }, t0)).rejects.toThrowError(InvitationLinkError);
    // The owner cannot resend to someone who said no.
    await expect(service.reinviteContact(ownerId, contact.id, t0)).rejects.toThrowError(/declined/);
    // But can deliberately ask again by adding them again.
    const again = await invite();
    expect(again.contact.id).toBe(contact.id);
    expect(again.contact.status).toBe("PENDING_INVITE");
  });

  it("an expired link is refused, reported once, and then stops matching", async () => {
    const { rawInviteToken, contact } = await invite({ isBeneficiary: false, isTrustedVerifier: true });
    const late = new Date(t0.getTime() + 14 * DAY); // exactly at the boundary counts as expired
    await expect(service.acceptContactInvitation({ rawInviteToken }, late)).rejects.toMatchObject({ reason: "EXPIRED" });
    await expect(service.acceptContactInvitation({ rawInviteToken }, late)).rejects.toMatchObject({ reason: "INVALID" });
    expect(store.audits.filter((a) => a.eventType === "CONTACT_INVITE_EXPIRED")).toHaveLength(1);
    expect((await store.findContactById(contact.id))?.status).toBe("PENDING_INVITE");
  });

  it("resending replaces the token: the old link stops working, the new one works", async () => {
    const first = await invite({ isBeneficiary: false, isTrustedVerifier: true });
    const second = await service.reinviteContact(ownerId, first.contact.id, new Date(t0.getTime() + DAY));
    expect(second.rawInviteToken).not.toBe(first.rawInviteToken);
    expect(second.contact.inviteExpiresAt?.getTime()).toBe(t0.getTime() + 15 * DAY);
    expect(store.audits.at(-1)?.eventType).toBe("CONTACT_REINVITED");

    await expect(
      service.acceptContactInvitation({ rawInviteToken: first.rawInviteToken }, t0)
    ).rejects.toThrowError(InvitationLinkError);
    const accepted = await service.acceptContactInvitation({ rawInviteToken: second.rawInviteToken }, t0);
    expect(accepted.status).toBe("VERIFIED");
    // Already accepted: nothing to resend.
    await expect(service.reinviteContact(ownerId, first.contact.id, t0)).rejects.toThrowError(/already accepted/);
  });

  it("only the owner can resend or cancel, and an accepted contact cannot be cancelled as an invitation", async () => {
    const { contact, rawInviteToken } = await invite({ isBeneficiary: false, isTrustedVerifier: true });
    await expect(service.reinviteContact("usr_other", contact.id, t0)).rejects.toThrowError(AuthorizationError);
    await expect(service.cancelInvitation("usr_other", contact.id)).rejects.toThrowError(AuthorizationError);

    const cancelled = await service.cancelInvitation(ownerId, contact.id);
    expect(cancelled.status).toBe("REVOKED");
    expect(cancelled.inviteTokenHash).toBeNull();
    expect(store.audits.at(-1)?.eventType).toBe("CONTACT_INVITE_CANCELED");
    await expect(service.acceptContactInvitation({ rawInviteToken }, t0)).rejects.toThrowError(InvitationLinkError);

    const second = await invite({ email: "bo@example.com", isBeneficiary: false, isTrustedVerifier: true });
    await service.acceptContactInvitation({ rawInviteToken: second.rawInviteToken }, t0);
    await expect(service.cancelInvitation(ownerId, second.contact.id)).rejects.toThrowError(ValidationError);
  });

  it("previewing a link shows the owner name and roles but never uses it up", async () => {
    const { rawInviteToken } = await invite({ isTrustedVerifier: true });
    const preview = await service.previewInvitation(rawInviteToken, t0);
    expect(preview).toMatchObject({ state: "VALID", ownerName: "Grace Owner", isBeneficiary: true, isTrustedVerifier: true });
    // Looking again, and again, changes nothing.
    await service.previewInvitation(rawInviteToken, t0);
    expect((await service.acceptContactInvitation({ rawInviteToken }, t0)).status).toBe("VERIFIED");

    expect(await service.previewInvitation(rawInviteToken, t0)).toEqual({ state: "INVALID" });
    expect(await service.previewInvitation("short", t0)).toEqual({ state: "INVALID" });
    expect(await service.previewInvitation(undefined, t0)).toEqual({ state: "INVALID" });
    expect(JSON.stringify(preview)).not.toContain("ada@example.com");
  });

  it("reports an expired link as expired, not as unknown", async () => {
    const { rawInviteToken } = await invite();
    expect(await service.previewInvitation(rawInviteToken, new Date(t0.getTime() + 15 * DAY))).toEqual({ state: "EXPIRED" });
  });

  it("removing someone who never accepted needs no confirmation, and a waiting verifier is not a safety net", async () => {
    const waiting = await invite({ email: "w@example.com", isBeneficiary: false, isTrustedVerifier: true });
    const accepted = await invite({ email: "a@example.com", isBeneficiary: false, isTrustedVerifier: true });
    await service.acceptContactInvitation({ rawInviteToken: accepted.rawInviteToken }, t0);

    await expect(
      service.suspendOrRevokeContact(ownerId, { contactId: accepted.contact.id, targetStatus: "REVOKED" })
    ).rejects.toThrowError(CriticalContactChangeWarningError);

    const removed = await service.suspendOrRevokeContact(ownerId, { contactId: waiting.contact.id, targetStatus: "REVOKED" });
    expect(removed.contact.status).toBe("REVOKED");
  });

  it("rejects a re-add while an invitation is already pending or accepted", async () => {
    await invite();
    await expect(invite()).rejects.toThrowError(/already exists/);
  });
});
