// lib/services/contact-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
  generateOpaqueToken,
  hashOpaqueToken,
} from "../auth/security";
import { redactForAuditLog } from "../domain/trust-boundary";
import { INVITE_TTL_MS } from "../domain/invitation-status";
import type { ContactStatus } from "@prisma/client";

/**
 * THE-100: Beneficiary & Trusted-Contact Management
 *
 * Enforces strict separation between:
 * - Beneficiaries (`isBeneficiary: true`): Recipients of scoped encrypted estate material.
 * - Trusted Verifiers (`isTrustedVerifier: true`): Contacts who can attest whether the user
 *   is alive (stopping false triggers) or verify release readiness, without receiving vault access.
 */

export const ContactRoleSchema = z
  .object({
    isBeneficiary: z.boolean(),
    isTrustedVerifier: z.boolean(),
  })
  .refine((r) => r.isBeneficiary || r.isTrustedVerifier, {
    message:
      "A contact must have at least one role: beneficiary, trusted verifier, or both.",
  });

export const CreateContactInputSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required").max(120),
    email: z.string().email().transform((e) => e.trim().toLowerCase()),
    phone: z.string().trim().min(7).max(30).optional(),
    isBeneficiary: z.boolean(),
    isTrustedVerifier: z.boolean(),
    // Generated in the owner's browser for a beneficiary. Stored when the person is added so the
    // invitation does not depend on a key from the invitee (zero-knowledge: no private key here).
    publicKeyBase64: z.string().min(32).max(400).optional().nullable(),
  })
  .refine((c) => c.isBeneficiary || c.isTrustedVerifier, {
    message:
      "A contact must be a beneficiary, a trusted verifier, or both.",
  });

export const DEFAULT_KEY_ALGORITHM = "ECDH-P256-HKDF-AES256GCM";

export const AcceptContactInviteInputSchema = z.object({
  rawInviteToken: z.string().min(16).max(200),
  publicKeyBase64: z.string().min(32).optional(),
  keyAlgorithm: z.string().default(DEFAULT_KEY_ALGORITHM),
});

export const UpdateContactRolesOrStatusInputSchema = z.object({
  contactId: z.string().min(1),
  isBeneficiary: z.boolean().optional(),
  isTrustedVerifier: z.boolean().optional(),
  confirmCriticalChange: z.boolean().default(false),
});

export interface ContactRecord {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  isBeneficiary: boolean;
  isTrustedVerifier: boolean;
  status: ContactStatus;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  verifiedAt: Date | null;
  publicKeyBase64: string | null;
  keyAlgorithm: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContactAuditEntry {
  userId: string;
  eventType: string;
  severity: string;
  redactedMeta: string;
  actorType?: "USER" | "BENEFICIARY" | "TRUSTED_CONTACT" | "SYSTEM";
  actorId?: string | null;
}

export interface ContactPersistencePort {
  findContactById(contactId: string): Promise<ContactRecord | null>;
  findContactByUserAndEmail(userId: string, email: string): Promise<ContactRecord | null>;
  findContactByInviteTokenHash(tokenHash: string): Promise<ContactRecord | null>;
  listContactsByUserId(userId: string): Promise<ContactRecord[]>;
  countReleaseAssignmentsForContact(contactId: string): Promise<number>;
  deleteReleaseAssignmentsForContact(contactId: string): Promise<number>;
  /** The owner's name for the invitation page and email, or null when they have not set one. */
  findOwnerDisplayName(userId: string): Promise<string | null>;
  createContact(data: {
    userId: string;
    fullName: string;
    email: string;
    phone: string | null;
    isBeneficiary: boolean;
    isTrustedVerifier: boolean;
    status: ContactStatus;
    inviteTokenHash: string;
    inviteExpiresAt: Date;
    publicKeyBase64: string | null;
    keyAlgorithm: string | null;
  }): Promise<ContactRecord>;
  updateContact(
    contactId: string,
    data: Partial<{
      fullName: string;
      email: string;
      phone: string | null;
      isBeneficiary: boolean;
      isTrustedVerifier: boolean;
      status: ContactStatus;
      inviteTokenHash: string | null;
      inviteExpiresAt: Date | null;
      verifiedAt: Date | null;
      publicKeyBase64: string | null;
      keyAlgorithm: string | null;
    }>
  ): Promise<ContactRecord>;
  deleteContact(contactId: string): Promise<void>;
  /**
   * The three methods below are ONE conditional write each (the check and the change happen
   * together in the database). They return null when the contact was no longer in the expected
   * state, so two simultaneous requests can never both win.
   */
  /** PENDING_INVITE + matching token + not expired -> VERIFIED, token cleared. */
  acceptPendingInvite(args: {
    tokenHash: string;
    now: Date;
    publicKeyBase64: string | null;
    keyAlgorithm: string | null;
  }): Promise<ContactRecord | null>;
  /** PENDING_INVITE + matching token + not expired -> DECLINED, token and key cleared. */
  declinePendingInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null>;
  /** PENDING_INVITE + matching token + already expired -> token cleared (status stays PENDING_INVITE). */
  clearExpiredInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null>;
  /** PENDING_INVITE contact (owned by userId) gets a new token; the old one stops working. */
  reissuePendingInvite(args: {
    contactId: string;
    userId: string;
    tokenHash: string;
    inviteExpiresAt: Date;
  }): Promise<ContactRecord | null>;
  appendAuditEvent(data: ContactAuditEntry): Promise<void>;
}

export class CriticalContactChangeWarningError extends Error {
  public readonly code = "CRITICAL_CONTACT_CHANGE_CONFIRMATION_REQUIRED";
  public readonly warningReasons: string[];

  constructor(message: string, warningReasons: string[]) {
    super(message);
    this.name = "CriticalContactChangeWarningError";
    this.warningReasons = warningReasons;
  }
}


/** The invitation link is not usable. `reason` lets the public page pick the right plain message. */
export class InvitationLinkError extends AuthorizationError {
  constructor(
    public readonly reason: "INVALID" | "EXPIRED",
    message: string
  ) {
    super(message);
    this.name = "InvitationLinkError";
  }
}

export type InvitationPreview =
  | {
      state: "VALID";
      ownerName: string | null;
      isBeneficiary: boolean;
      isTrustedVerifier: boolean;
      expiresAt: Date;
    }
  | { state: "EXPIRED" }
  | { state: "INVALID" };

/**
 * Pure domain eligibility helpers (THE-100):
 * Ensure stale, unverified, suspended, or revoked contacts cannot participate in release flows
 * and that verifier vs. recipient roles are never conflated.
 */
export function canParticipateInReleaseVerification(contact: ContactRecord): boolean {
  return (
    contact.status === "VERIFIED" &&
    contact.isTrustedVerifier === true &&
    contact.verifiedAt !== null
  );
}

export function canReceiveReleasePackage(contact: ContactRecord): boolean {
  return (
    contact.status === "VERIFIED" &&
    contact.isBeneficiary === true &&
    contact.verifiedAt !== null &&
    Boolean(contact.publicKeyBase64 && contact.publicKeyBase64.length >= 32)
  );
}

export class ContactService {
  constructor(private readonly store: ContactPersistencePort) {}

  /**
   * Invites a new Beneficiary, Trusted Verifier, or dual-role Contact. The contact starts as
   * PENDING_INVITE and cannot take part in a release until they accept. Returns the raw token,
   * which the caller must email to the contact and must never store or log.
   */
  async inviteContact(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    contact: ContactRecord;
    rawInviteToken: string;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const parsed = CreateContactInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid contact details."
      );
    }
    const input = parsed.data;

    const existing = await this.store.findContactByUserAndEmail(
      authenticatedUserId,
      input.email
    );
    if (existing && existing.status !== "REVOKED" && existing.status !== "DECLINED") {
      throw new ValidationError("A contact with this email already exists.");
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);
    const publicKeyBase64 = input.isBeneficiary ? (input.publicKeyBase64 ?? null) : null;
    const keyAlgorithm = publicKeyBase64 ? DEFAULT_KEY_ALGORITHM : null;

    let contact: ContactRecord;
    if (existing) {
      // A removed or declined person is asked again from scratch.
      contact = await this.store.updateContact(existing.id, {
        fullName: input.fullName,
        phone: input.phone ?? null,
        isBeneficiary: input.isBeneficiary,
        isTrustedVerifier: input.isTrustedVerifier,
        status: "PENDING_INVITE",
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        verifiedAt: null,
        publicKeyBase64,
        keyAlgorithm,
      });
    } else {
      contact = await this.store.createContact({
        userId: authenticatedUserId,
        fullName: input.fullName,
        email: input.email,
        phone: input.phone ?? null,
        isBeneficiary: input.isBeneficiary,
        isTrustedVerifier: input.isTrustedVerifier,
        status: "PENDING_INVITE",
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        publicKeyBase64,
        keyAlgorithm,
      });
    }

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "CONTACT_INVITED",
      severity: "INFO",
      actorType: "USER",
      actorId: authenticatedUserId,
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          contactId: contact.id,
          email: contact.email,
          isBeneficiary: contact.isBeneficiary,
          isTrustedVerifier: contact.isTrustedVerifier,
          token: rawToken, // Automatically redacted
        })
      ),
    });

    return { contact, rawInviteToken: rawToken };
  }

  /**
   * Sends a PENDING_INVITE contact a fresh invitation: a new single-use token and a new
   * 14-day window. The previous link stops working at once. Someone who already answered
   * (accepted, declined or removed) cannot be re-invited this way.
   */
  async reinviteContact(
    authenticatedUserId: string | null | undefined,
    contactId: string,
    now = new Date()
  ): Promise<{ contact: ContactRecord; rawInviteToken: string }> {
    const contact = assertResourceOwnership(
      await this.store.findContactById(contactId),
      authenticatedUserId,
      "Contact"
    );

    if (contact.status !== "PENDING_INVITE") {
      throw new ValidationError(
        contact.status === "VERIFIED"
          ? "This person has already accepted."
          : contact.status === "DECLINED"
            ? "This person declined. Remove them and add them again if you want to ask again."
            : "Cannot re-invite this contact; create a new invitation."
      );
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const updated = await this.store.reissuePendingInvite({
      contactId: contact.id,
      userId: contact.userId,
      tokenHash,
      inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });
    if (!updated) {
      throw new ValidationError("This person has just replied, so a new invitation was not sent.");
    }

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_REINVITED",
      severity: "INFO",
      actorType: "USER",
      actorId: contact.userId,
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        email: contact.email,
        isBeneficiary: contact.isBeneficiary,
        isTrustedVerifier: contact.isTrustedVerifier,
      }),
    });

    return { contact: updated, rawInviteToken: rawToken };
  }

  /**
   * Withdraws an invitation that has not been accepted (waiting, expired or declined).
   * The contact becomes REVOKED and the link stops working.
   */
  async cancelInvitation(
    authenticatedUserId: string | null | undefined,
    contactId: string
  ): Promise<ContactRecord> {
    const contact = assertResourceOwnership(
      await this.store.findContactById(contactId),
      authenticatedUserId,
      "Contact"
    );
    if (contact.status !== "PENDING_INVITE" && contact.status !== "DECLINED") {
      throw new ValidationError("Only an invitation that has not been accepted can be cancelled.");
    }

    const updated = await this.store.updateContact(contact.id, {
      status: "REVOKED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      publicKeyBase64: null,
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_INVITE_CANCELED",
      severity: "INFO",
      actorType: "USER",
      actorId: contact.userId,
      redactedMeta: JSON.stringify({ contactId: contact.id, email: contact.email }),
    });
    return updated;
  }

  /**
   * Read-only look at an invitation, for the public page. Never changes anything, so an email
   * scanner that opens the link cannot use it up. Says nothing about the owner except their name.
   */
  async previewInvitation(rawToken: unknown, now = new Date()): Promise<InvitationPreview> {
    if (typeof rawToken !== "string" || rawToken.length < 16 || rawToken.length > 200) {
      return { state: "INVALID" };
    }
    const contact = await this.store.findContactByInviteTokenHash(hashOpaqueToken(rawToken));
    if (!contact || contact.status !== "PENDING_INVITE" || !contact.inviteExpiresAt) {
      return { state: "INVALID" };
    }
    if (contact.inviteExpiresAt.getTime() <= now.getTime()) {
      return { state: "EXPIRED" };
    }
    return {
      state: "VALID",
      ownerName: await this.store.findOwnerDisplayName(contact.userId),
      isBeneficiary: contact.isBeneficiary,
      isTrustedVerifier: contact.isTrustedVerifier,
      expiresAt: contact.inviteExpiresAt,
    };
  }

  /**
   * Accepts a contact invitation using the single-use invite token.
   * A beneficiary needs a public key (stored when the owner added them, or supplied here) so
   * release packages can be wrapped to it. The token is consumed by one conditional write, so
   * two simultaneous clicks accept exactly once.
   */
  async acceptContactInvitation(
    rawInput: unknown,
    now = new Date()
  ): Promise<ContactRecord> {
    const parsed = AcceptContactInviteInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid invitation acceptance parameters.");
    }
    const input = parsed.data;

    const tokenHash = hashOpaqueToken(input.rawInviteToken);
    const contact = await this.assertInviteUsable(tokenHash, now);

    const publicKeyBase64 = input.publicKeyBase64 ?? contact.publicKeyBase64;
    if (contact.isBeneficiary && !publicKeyBase64) {
      throw new ValidationError(
        "Beneficiary contacts must provide a publicKeyBase64 during invitation acceptance so items can be encrypted to them."
      );
    }

    const updated = await this.store.acceptPendingInvite({
      tokenHash,
      now,
      publicKeyBase64: contact.isBeneficiary ? (publicKeyBase64 ?? null) : null,
      keyAlgorithm: contact.isBeneficiary ? input.keyAlgorithm : null,
    });
    if (!updated) {
      // Someone else used the link between our check and our write.
      throw new InvitationLinkError("INVALID", "Invitation token is invalid or has already been used.");
    }

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_INVITE_ACCEPTED",
      severity: "INFO",
      actorType: contact.isBeneficiary ? "BENEFICIARY" : "TRUSTED_CONTACT",
      actorId: contact.id,
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        isBeneficiary: contact.isBeneficiary,
        isTrustedVerifier: contact.isTrustedVerifier,
      }),
    });

    return updated;
  }

  /** The invitee chose "Decline". Same single-use rules as accepting. */
  async declineContactInvitation(
    rawInput: unknown,
    now = new Date()
  ): Promise<ContactRecord> {
    const parsed = z.object({ rawInviteToken: z.string().min(16).max(200) }).safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid invitation parameters.");
    }
    const tokenHash = hashOpaqueToken(parsed.data.rawInviteToken);
    const contact = await this.assertInviteUsable(tokenHash, now);

    const updated = await this.store.declinePendingInvite({ tokenHash, now });
    if (!updated) {
      throw new InvitationLinkError("INVALID", "Invitation token is invalid or has already been used.");
    }

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_INVITE_DECLINED",
      severity: "INFO",
      actorType: contact.isBeneficiary ? "BENEFICIARY" : "TRUSTED_CONTACT",
      actorId: contact.id,
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        isBeneficiary: contact.isBeneficiary,
        isTrustedVerifier: contact.isTrustedVerifier,
      }),
    });
    return updated;
  }

  /**
   * Finds the contact behind a token and checks it can still be used. An expired token is
   * withdrawn (once) and recorded as an "expired" audit event.
   */
  private async assertInviteUsable(tokenHash: string, now: Date): Promise<ContactRecord> {
    const contact = await this.store.findContactByInviteTokenHash(tokenHash);
    if (!contact || contact.status !== "PENDING_INVITE") {
      throw new InvitationLinkError("INVALID", "Invitation token is invalid or has already been used.");
    }

    if (!contact.inviteExpiresAt || contact.inviteExpiresAt.getTime() <= now.getTime()) {
      const cleared = await this.store.clearExpiredInvite({ tokenHash, now });
      if (cleared) {
        await this.store.appendAuditEvent({
          userId: contact.userId,
          eventType: "CONTACT_INVITE_EXPIRED",
          severity: "INFO",
          actorType: "SYSTEM",
          actorId: null,
          redactedMeta: JSON.stringify({
            contactId: contact.id,
            isBeneficiary: contact.isBeneficiary,
            isTrustedVerifier: contact.isTrustedVerifier,
          }),
        });
      }
      throw new InvitationLinkError("EXPIRED", "Invitation token has expired.");
    }
    return contact;
  }

  /**
   * Suspends, revokes, or removes a contact, or removes critical roles.
   * Enforces THE-100 safety warnings if:
   * 1. Removing/suspending the last active Trusted Verifier.
   * 2. Removing/suspending a Beneficiary who has active release assignments.
   */
  async suspendOrRevokeContact(
    authenticatedUserId: string | null | undefined,
    params: {
      contactId: string;
      targetStatus: "SUSPENDED" | "REVOKED";
      confirmCriticalChange?: boolean;
    }
  ): Promise<{ contact: ContactRecord; invalidatedAssignmentsCount: number }> {
    const contact = assertResourceOwnership(
      await this.store.findContactById(params.contactId),
      authenticatedUserId,
      "Contact"
    );

    const warnings = await this.evaluateCriticalContactImpact(
      contact.userId,
      contact
    );

    if (warnings.length > 0 && !params.confirmCriticalChange) {
      throw new CriticalContactChangeWarningError(
        `Confirmation required before modifying release-critical contact (${warnings.join(", ")}).`,
        warnings
      );
    }

    let invalidatedAssignmentsCount = 0;
    if (params.targetStatus === "REVOKED") {
      invalidatedAssignmentsCount =
        await this.store.deleteReleaseAssignmentsForContact(contact.id);
    }

    const updated = await this.store.updateContact(contact.id, {
      status: params.targetStatus,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      publicKeyBase64:
        params.targetStatus === "REVOKED" ? null : contact.publicKeyBase64,
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType:
        params.targetStatus === "REVOKED" ? "CONTACT_REVOKED" : "CONTACT_SUSPENDED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        email: contact.email,
        warningsAcknowledged: warnings,
        invalidatedAssignmentsCount,
      }),
    });

    return { contact: updated, invalidatedAssignmentsCount };
  }

  /**
   * Replaces an existing contact with a new contact while preserving role configuration,
   * revoking the old contact's credentials/assignments, and issuing a fresh invite to the replacement.
   */
  async replaceContact(
    authenticatedUserId: string | null | undefined,
    params: {
      oldContactId: string;
      newFullName: string;
      newEmail: string;
      newPhone?: string;
      confirmCriticalChange: boolean;
    },
    now = new Date()
  ): Promise<{
    revokedOldContact: ContactRecord;
    newContact: ContactRecord;
    rawInviteToken: string;
  }> {
    const oldContact = assertResourceOwnership(
      await this.store.findContactById(params.oldContactId),
      authenticatedUserId,
      "Contact"
    );

    const { contact: revokedOldContact } = await this.suspendOrRevokeContact(
      authenticatedUserId,
      {
        contactId: oldContact.id,
        targetStatus: "REVOKED",
        confirmCriticalChange: params.confirmCriticalChange,
      }
    );

    const { contact: newContact, rawInviteToken } = await this.inviteContact(
      authenticatedUserId,
      {
        fullName: params.newFullName,
        email: params.newEmail,
        phone: params.newPhone,
        isBeneficiary: oldContact.isBeneficiary,
        isTrustedVerifier: oldContact.isTrustedVerifier,
      },
      now
    );

    await this.store.appendAuditEvent({
      userId: oldContact.userId,
      eventType: "CONTACT_REPLACED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        oldContactId: oldContact.id,
        newContactId: newContact.id,
      }),
    });

    return {
      revokedOldContact,
      newContact,
      rawInviteToken,
    };
  }

  private async evaluateCriticalContactImpact(
    userId: string,
    targetContact: ContactRecord
  ): Promise<string[]> {
    const warnings: string[] = [];
    const allContacts = await this.store.listContactsByUserId(userId);

    // Someone who never accepted was never part of the plan, so removing them is not critical.
    if (targetContact.status === "PENDING_INVITE" || targetContact.status === "DECLINED") {
      return warnings;
    }

    if (targetContact.isTrustedVerifier && targetContact.status !== "REVOKED") {
      // Only accepted verifiers count: a waiting invitation cannot confirm anything yet.
      const remainingActiveVerifiers = allContacts.filter(
        (c) => c.id !== targetContact.id && c.isTrustedVerifier && c.status === "VERIFIED"
      );
      if (remainingActiveVerifiers.length === 0) {
        warnings.push("REMOVING_LAST_TRUSTED_VERIFIER");
      }
    }

    if (targetContact.isBeneficiary) {
      const assignmentCount = await this.store.countReleaseAssignmentsForContact(
        targetContact.id
      );
      if (assignmentCount > 0) {
        warnings.push(`CONTACT_HAS_${assignmentCount}_ASSIGNED_RELEASE_ITEMS`);
      }
    }

    return warnings;
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };