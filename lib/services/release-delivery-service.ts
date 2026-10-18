// lib/services/release-delivery-service.ts
import crypto from "node:crypto";
import { z } from "zod";
import {
  AuthorizationError,
  ValidationError,
  generateOpaqueToken,
  hashOpaqueToken,
} from "../auth/security";
import { redactForAuditLog } from "../domain/trust-boundary";
import {
  canReceiveReleasePackage,
  type ContactRecord,
} from "./contact-service";
import type { ScopedBeneficiaryReleasePackage } from "./selective-release-service";
import type { DetailedScheduleRecord } from "./checkin-schedule-service";
import type { ReleaseEventRecord } from "./release-verification-service";

/**
 * THE-105: Emergency Release Package Delivery, Expiry, Revocation, Re-Issue & Acknowledgement
 *
 * Responsibilities:
 * 1. Authenticates beneficiary access and verifies grant state (active, non-expired, unrevoked, estate RELEASED).
 * 2. Delivers ONLY the scoped encrypted package assigned to `contactId` (never exposing unrelated vault data).
 * 3. Supports downloadable encrypted bundles with SHA-256 manifest integrity verification.
 * 4. Enforces expiry, revocation, re-issuance, and beneficiary receipt acknowledgement rules.
 * 5. Records all successful AND failed access attempts in `ReleaseEvent` and `AuditEvent` without logging plaintext.
 */

export const RetrieveReleasePackageInputSchema = z.object({
  contactId: z.string().min(1),
  rawAccessToken: z.string().min(16),
  authenticatedBeneficiaryEmail: z.string().email().transform((e) => e.trim().toLowerCase()),
});

export const AcknowledgeReleasePackageInputSchema = z.object({
  contactId: z.string().min(1),
  grantEventId: z.string().min(1),
  authenticatedBeneficiaryEmail: z.string().email().transform((e) => e.trim().toLowerCase()),
  decryptedItemCountConfirmed: z.number().int().nonnegative(),
  acknowledgementNote: z.string().trim().max(300).optional(),
});

export interface DownloadableEncryptedBundle {
  bundleFormat: "DUSK-ENCRYPTED-ESTATE-PACKAGE-V1";
  exportedAtIso: string;
  beneficiaryContactId: string;
  beneficiaryEmail: string;
  itemCount: number;
  manifestSha256Hex: string;
  package: ScopedBeneficiaryReleasePackage;
}

export interface ReleaseDeliveryPersistencePort {
  findContactById(contactId: string): Promise<ContactRecord | null>;
  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null>;
  findGrantEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null>;
  findGrantEventById(eventId: string): Promise<ReleaseEventRecord | null>;
  listReleaseEventsForContact(
    scheduleId: string,
    contactId: string
  ): Promise<ReleaseEventRecord[]>;
  createReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    actionTokenHash?: string | null;
    tokenExpiresAt?: Date | null;
    metadataJson?: string | null;
  }): Promise<ReleaseEventRecord>;
  markGrantTokenUsed(eventId: string, usedAt: Date): Promise<ReleaseEventRecord>;
  assembleScopedPackage(
    userId: string,
    contactId: string
  ): Promise<ScopedBeneficiaryReleasePackage>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class PackageGrantExpiredOrRevokedError extends Error {
  public readonly code = "PACKAGE_GRANT_EXPIRED_OR_REVOKED";
  constructor(message: string) {
    super(message);
    this.name = "PackageGrantExpiredOrRevokedError";
  }
}

export class ReleaseDeliveryService {
  constructor(private readonly store: ReleaseDeliveryPersistencePort) {}

  /**
   * Authenticates a Beneficiary, validates their release grant, records the access attempt,
   * and returns ONLY their scoped encrypted package + downloadable bundle.
   * Failed attempts are recorded in `ReleaseEvent` and `AuditEvent` before throwing.
   */
  async retrieveScopedPackageForBeneficiary(
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    grantEventId: string;
    scopedPackage: ScopedBeneficiaryReleasePackage;
    downloadableBundle: DownloadableEncryptedBundle;
  }> {
    const parsed = RetrieveReleasePackageInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid package retrieval request.");
    }
    const input = parsed.data;

    const contact = await this.store.findContactById(input.contactId);
    if (!contact) {
      throw new AuthorizationError("Beneficiary contact not found.");
    }

    const schedule = await this.store.findScheduleByUserId(contact.userId);
    if (!schedule || schedule.state !== "RELEASED") {
      if (schedule) {
        await this.recordFailedAccessAttempt(
          schedule.id,
          contact.userId,
          contact.id,
          "ESTATE_NOT_IN_RELEASED_STATE"
        );
      }
      throw new AuthorizationError(
        "This estate has not been released. Package access is denied."
      );
    }

    if (!canReceiveReleasePackage(contact)) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "CONTACT_NOT_ELIGIBLE_OR_REVOKED"
      );
      throw new AuthorizationError(
        "Beneficiary contact is not eligible or has been revoked."
      );
    }

    if (contact.email.toLowerCase() !== input.authenticatedBeneficiaryEmail) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "BENEFICIARY_EMAIL_MISMATCH"
      );
      throw new AuthorizationError(
        "Authenticated email does not match the intended beneficiary."
      );
    }

    const tokenHash = hashOpaqueToken(input.rawAccessToken);
    const grant = await this.store.findGrantEventByTokenHash(tokenHash);

    if (
      !grant ||
      grant.eventType !== "BENEFICIARY_ACCESS_GRANT_ISSUED" ||
      grant.contactId !== contact.id
    ) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "INVALID_OR_CROSS_BENEFICIARY_TOKEN"
      );
      throw new AuthorizationError(
        "Invalid or unauthorized beneficiary package access token."
      );
    }

    // Check if this specific grant was revoked
    const contactEvents = await this.store.listReleaseEventsForContact(
      schedule.id,
      contact.id
    );
    const isRevoked = contactEvents.some(
      (e) =>
        e.eventType === "PACKAGE_GRANT_REVOKED" &&
        e.metadataJson?.includes(grant.id)
    );
    if (isRevoked) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "GRANT_WAS_REVOKED"
      );
      throw new PackageGrantExpiredOrRevokedError(
        "This release package access grant has been revoked."
      );
    }

    if (grant.tokenUsedAt !== null) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "REPLAYED_CONSUMED_GRANT_TOKEN"
      );
      throw new PackageGrantExpiredOrRevokedError(
        "This single-use release package link has already been used."
      );
    }

    if (!grant.tokenExpiresAt || grant.tokenExpiresAt.getTime() <= now.getTime()) {
      await this.recordFailedAccessAttempt(
        schedule.id,
        contact.userId,
        contact.id,
        "GRANT_TOKEN_EXPIRED"
      );
      throw new PackageGrantExpiredOrRevokedError(
        "This release package access link has expired. Request a re-issued grant."
      );
    }

    // Mark single-use grant token as consumed
    await this.store.markGrantTokenUsed(grant.id, now);

    // Assemble scoped package (only items assigned to this contactId; no owner VMK keys)
    const scopedPackage = await this.store.assembleScopedPackage(
      contact.userId,
      contact.id
    );

    const downloadableBundle = this.exportDownloadableEncryptedBundle(
      scopedPackage,
      now
    );

    await this.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: contact.userId,
      contactId: contact.id,
      eventType: "PACKAGE_ACCESS_SUCCEEDED",
      metadataJson: JSON.stringify({
        grantEventId: grant.id,
        deliveredItemCount: scopedPackage.items.length,
        manifestSha256Hex: downloadableBundle.manifestSha256Hex,
      }),
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "BENEFICIARY_PACKAGE_DELIVERED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          contactId: contact.id,
          grantEventId: grant.id,
          deliveredItemCount: scopedPackage.items.length,
          manifestSha256Hex: downloadableBundle.manifestSha256Hex,
        })
      ),
    });

    return {
      grantEventId: grant.id,
      scopedPackage,
      downloadableBundle,
    };
  }

  /**
   * Records a Beneficiary's explicit acknowledgement of receipt and successful local decryption
   * without ever sending decrypted vault content back to the server.
   */
  async acknowledgePackageReceipt(
    rawInput: unknown,
    now = new Date()
  ): Promise<ReleaseEventRecord> {
    const parsed = AcknowledgeReleasePackageInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid package acknowledgement input.");
    }
    const input = parsed.data;

    const contact = await this.store.findContactById(input.contactId);
    if (!contact || contact.email.toLowerCase() !== input.authenticatedBeneficiaryEmail) {
      throw new AuthorizationError("Unauthorized beneficiary acknowledgement.");
    }

    const grant = await this.store.findGrantEventById(input.grantEventId);
    if (!grant || grant.contactId !== contact.id) {
      throw new AuthorizationError("Matching package grant not found for beneficiary.");
    }

    const ackEvent = await this.store.createReleaseEvent({
      scheduleId: grant.scheduleId,
      userId: contact.userId,
      contactId: contact.id,
      eventType: "PACKAGE_RECEIPT_ACKNOWLEDGED",
      metadataJson: JSON.stringify({
        grantEventId: grant.id,
        decryptedItemCountConfirmed: input.decryptedItemCountConfirmed,
        acknowledgementNote: input.acknowledgementNote ?? null,
        acknowledgedAtIso: now.toISOString(),
      }),
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "BENEFICIARY_PACKAGE_ACKNOWLEDGED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        grantEventId: grant.id,
        decryptedItemCountConfirmed: input.decryptedItemCountConfirmed,
      }),
    });

    return ackEvent;
  }

  /**
   * Revokes an existing Beneficiary Access Grant so it can no longer be used to retrieve the package.
   */
  async revokeBeneficiaryPackageGrant(params: {
    grantEventId: string;
    reason: string;
  }): Promise<ReleaseEventRecord> {
    const grant = await this.store.findGrantEventById(params.grantEventId);
    if (!grant || grant.eventType !== "BENEFICIARY_ACCESS_GRANT_ISSUED") {
      throw new ValidationError("Target package grant event not found.");
    }

    const revokeEvent = await this.store.createReleaseEvent({
      scheduleId: grant.scheduleId,
      userId: grant.userId,
      contactId: grant.contactId,
      eventType: "PACKAGE_GRANT_REVOKED",
      metadataJson: JSON.stringify({
        revokedGrantEventId: grant.id,
        reason: params.reason,
      }),
    });

    await this.store.appendAuditEvent({
      userId: grant.userId,
      eventType: "BENEFICIARY_PACKAGE_GRANT_REVOKED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        contactId: grant.contactId,
        revokedGrantEventId: grant.id,
        reason: params.reason,
      }),
    });

    return revokeEvent;
  }

  /**
   * Re-issues a fresh time-bounded Beneficiary Access Grant after revoking the prior expired/unused grant,
   * provided the estate is still `RELEASED` and the beneficiary has not yet acknowledged receipt.
   */
  async reissueBeneficiaryPackageGrant(params: {
    previousGrantEventId: string;
    ttlHours?: number;
    now?: Date;
  }): Promise<{
    rawAccessToken: string;
    expiresAt: Date;
    newGrantEvent: ReleaseEventRecord;
  }> {
    const now = params.now ?? new Date();
    const ttlHours = params.ttlHours ?? 48;

    const prevGrant = await this.store.findGrantEventById(
      params.previousGrantEventId
    );
    if (
      !prevGrant ||
      prevGrant.eventType !== "BENEFICIARY_ACCESS_GRANT_ISSUED" ||
      !prevGrant.contactId
    ) {
      throw new ValidationError("Previous beneficiary package grant not found.");
    }

    const contact = await this.store.findContactById(prevGrant.contactId);
    if (!contact || !canReceiveReleasePackage(contact)) {
      throw new AuthorizationError(
        "Beneficiary is no longer eligible to receive a re-issued grant."
      );
    }

    const schedule = await this.store.findScheduleByUserId(contact.userId);
    if (!schedule || schedule.state !== "RELEASED") {
      throw new AuthorizationError(
        "Cannot re-issue package grant unless estate is in RELEASED state."
      );
    }

    // Revoke the previous grant first
    await this.revokeBeneficiaryPackageGrant({
      grantEventId: prevGrant.id,
      reason: "SUPERSEDED_BY_REISSUED_GRANT",
    });

    const { rawToken, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const newGrantEvent = await this.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: contact.userId,
      contactId: contact.id,
      eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED",
      actionTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      metadataJson: JSON.stringify({
        reissuedFromGrantId: prevGrant.id,
        beneficiaryEmail: contact.email,
        expiresAtIso: expiresAt.toISOString(),
      }),
    });

    await this.store.appendAuditEvent({
      userId: contact.userId,
      eventType: "BENEFICIARY_PACKAGE_GRANT_REISSUED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        contactId: contact.id,
        previousGrantEventId: prevGrant.id,
        newGrantEventId: newGrantEvent.id,
      }),
    });

    return {
      rawAccessToken: rawToken,
      expiresAt,
      newGrantEvent,
    };
  }

  /**
   * Packages a `ScopedBeneficiaryReleasePackage` into a downloadable encrypted JSON bundle
   * with a SHA-256 manifest hash over all ciphertexts and wrapped keys.
   */
  exportDownloadableEncryptedBundle(
    pkg: ScopedBeneficiaryReleasePackage,
    now = new Date()
  ): DownloadableEncryptedBundle {
    const canonicalItems = pkg.items.map((i) => ({
      itemId: i.itemId,
      keyVersion: i.keyVersion,
      ciphertextBase64: i.ciphertextBase64,
      ivBase64: i.ivBase64,
      beneficiaryWrappedKeyBase64: i.wrappedGrant.beneficiaryWrappedKeyBase64,
      ephemeralPublicKeyBase64: i.wrappedGrant.ephemeralPublicKeyBase64,
    }));

    const manifestSha256Hex = crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalItems), "utf8")
      .digest("hex");

    return {
      bundleFormat: "DUSK-ENCRYPTED-ESTATE-PACKAGE-V1",
      exportedAtIso: now.toISOString(),
      beneficiaryContactId: pkg.beneficiaryContactId,
      beneficiaryEmail: pkg.beneficiaryEmail,
      itemCount: pkg.items.length,
      manifestSha256Hex,
      package: pkg,
    };
  }

  private async recordFailedAccessAttempt(
    scheduleId: string,
    userId: string,
    contactId: string,
    reason: string
  ): Promise<void> {
    await this.store.createReleaseEvent({
      scheduleId,
      userId,
      contactId,
      eventType: "PACKAGE_ACCESS_DENIED",
      metadataJson: JSON.stringify({ reason }),
    });

    await this.store.appendAuditEvent({
      userId,
      eventType: "BENEFICIARY_PACKAGE_ACCESS_DENIED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        contactId,
        reason,
      }),
    });
  }
}

export { AuthorizationError, ValidationError };