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
  })
  .refine((c) => c.isBeneficiary || c.isTrustedVerifier, {
    message:
      "A contact must be a beneficiary, a trusted verifier, or both.",
  });

export const AcceptContactInviteInputSchema = z.object({
  rawInviteToken: z.string().min(16),
  publicKeyBase64: z.string().min(32).optional(),
  keyAlgorithm: z.string().default("ECDH-P256-HKDF-AES256GCM"),
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

export interface ContactPersistencePort {
  findContactById(contactId: string): Promise<ContactRecord | null>;
  findContactByUserAndEmail(userId: string, email: string): Promise<ContactRecord | null>;
  findContactByInviteTokenHash(tokenHash: string): Promise<ContactRecord | null>;
  listContactsByUserId(userId: string): Promise<ContactRecord[]>;
  countReleaseAssignmentsForContact(contactId: string): Promise<number>;
  deleteReleaseAssignmentsForContact(contactId: string): Promise<number>;
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
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
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

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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
   * Invites a new Beneficiary, Trusted Verifier, or dual-role Contact.
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
    if (existing && existing.status !== "REVOKED") {
      throw new ValidationError("A contact with this email already exists.");
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const inviteExpiresAt = new Date(now.getTime() + INVITE_TTL_MS);

    let contact: ContactRecord;
    if (existing && existing.status === "REVOKED") {
      contact = await this.store.updateContact(existing.id, {
        fullName: input.fullName,
        phone: input.phone ?? null,
        isBeneficiary: input.isBeneficiary,
        isTrustedVerifier: input.isTrustedVerifier,
        status: "PENDING_INVITE",
        inviteTokenHash: tokenHash,
        inviteExpiresAt,
        verifiedAt: null,
        publicKeyBase64: null,
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
      });
    }

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "CONTACT_INVITED",
      severity: "INFO",
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
   * Re-invites a PENDING_INVITE or SUSPENDED contact by rotating their single-use
   * invitation token and extending expiration.
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

    if (contact.status === "REVOKED") {
      throw new ValidationError("Cannot re-invite a revoked contact; create a new invitation.");
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const updated = await this.store.updateContact(contact.id, {
      status: "PENDING_INVITE",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_REINVITED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        email: contact.email,
      }),
    });

    return { contact: updated, rawInviteToken: rawToken };
  }

  /**
   * Accepts a contact invitation using the single-use invite token.
   * If the contact is a Beneficiary (`isBeneficiary: true`), requires `publicKeyBase64`
   * so selective release packages (`THE-101`) can be wrapped to their public key.
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
    const contact = await this.store.findContactByInviteTokenHash(tokenHash);

    if (!contact || contact.status !== "PENDING_INVITE") {
      throw new AuthorizationError("Invitation token is invalid or has already been used.");
    }

    if (!contact.inviteExpiresAt || contact.inviteExpiresAt.getTime() <= now.getTime()) {
      throw new AuthorizationError("Invitation token has expired.");
    }

    if (contact.isBeneficiary && !input.publicKeyBase64) {
      throw new ValidationError(
        "Beneficiary contacts must provide a publicKeyBase64 during invitation acceptance so items can be encrypted to them."
      );
    }

    const updated = await this.store.updateContact(contact.id, {
      status: "VERIFIED",
      inviteTokenHash: null, // Consume single-use token to prevent replay
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: contact.isBeneficiary ? (input.publicKeyBase64 ?? null) : null,
      keyAlgorithm: contact.isBeneficiary ? input.keyAlgorithm : null,
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "CONTACT_INVITE_ACCEPTED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        isBeneficiary: contact.isBeneficiary,
        isTrustedVerifier: contact.isTrustedVerifier,
      }),
    });

    return updated;
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

    if (targetContact.isTrustedVerifier && targetContact.status !== "REVOKED") {
      const remainingActiveVerifiers = allContacts.filter(
        (c) =>
          c.id !== targetContact.id &&
          c.isTrustedVerifier &&
          (c.status === "VERIFIED" || c.status === "PENDING_INVITE")
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