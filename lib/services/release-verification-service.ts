// lib/services/release-verification-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
  generateOpaqueToken,
  hashOpaqueToken,
} from "../auth/security";
import {
  evaluateFailClosedReleasePolicy,
  redactForAuditLog,
} from "../domain/trust-boundary";
import {
  canParticipateInReleaseVerification,
  canReceiveReleasePackage,
  type ContactRecord,
} from "./contact-service";
import type {
  DetailedScheduleRecord,
  WorkflowEventRecord,
} from "./checkin-schedule-service";

/**
 * THE-104: Release Verification & Beneficiary Access Authorization
 *
 * Invariants:
 * 1. No beneficiary package is ever released from an inactivity timer alone.
 * 2. Multi-party verifier policies require `requiredVerifierApprovals` DISTINCT verified Trusted Verifiers.
 * 3. Any active Release Hold (`RELEASE_HOLD`) or Alive Signal immediately blocks release authorization.
 * 4. Beneficiary access tokens are time-bounded, scoped to a single `contactId`, and replay-resistant.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const VerifierApprovalInputSchema = z.object({
  scheduleId: z.string().min(1),
  contactId: z.string().min(1),
  verificationStatement: z.string().trim().min(5).max(500),
  externalAdapterType: z
    .enum(["NONE", "DEATH_CERTIFICATE_ATTESTATION", "NOTARY_EXECUTOR_ATTESTATION"])
    .default("NONE"),
});

export const PlaceReleaseHoldInputSchema = z.object({
  scheduleId: z.string().min(1),
  actorType: z.enum(["USER", "TRUSTED_CONTACT"]),
  actorId: z.string().min(1),
  holdReason: z.string().trim().min(3).max(300),
});

export interface ReleaseEventRecord {
  id: string;
  scheduleId: string;
  userId: string;
  contactId: string | null;
  eventType: string;
  actionTokenHash: string | null;
  tokenExpiresAt: Date | null;
  tokenUsedAt: Date | null;
  metadataJson: string | null;
  createdAt: Date;
}

export interface ReleaseVerificationPersistencePort {
  findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null>;
  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null>;
  findContactById(contactId: string): Promise<ContactRecord | null>;
  listReleaseEventsByScheduleId(scheduleId: string): Promise<ReleaseEventRecord[]>;
  findReleaseEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null>;
  createReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    actionTokenHash?: string | null;
    tokenExpiresAt?: Date | null;
    metadataJson?: string | null;
  }): Promise<ReleaseEventRecord>;
  markReleaseEventTokenUsed(
    eventId: string,
    usedAt: Date
  ): Promise<ReleaseEventRecord>;
  updateScheduleState(params: {
    scheduleId: string;
    expectedVersion: number;
    data: Partial<DetailedScheduleRecord>;
    event: {
      userId: string;
      fromState: DetailedScheduleRecord["state"];
      toState: DetailedScheduleRecord["state"];
      reason: string;
      idempotencyKey: string;
      actorType: "USER" | "SYSTEM_SCHEDULER" | "TRUSTED_CONTACT";
      actorId: string | null;
    };
  }): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class ReleaseHoldActiveError extends Error {
  public readonly code = "RELEASE_HOLD_ACTIVE";
  constructor(message = "Release is currently blocked by an active Release Hold.") {
    super(message);
    this.name = "ReleaseHoldActiveError";
  }
}

export class ReleasePolicyNotSatisfiedError extends Error {
  public readonly code = "RELEASE_POLICY_NOT_SATISFIED";
  public readonly failClosedReasons: string[];
  constructor(reasons: string[]) {
    super(`Release policy not satisfied: ${reasons.join(", ")}`);
    this.name = "ReleasePolicyNotSatisfiedError";
    this.failClosedReasons = reasons;
  }
}

export class ReleaseVerificationService {
  constructor(private readonly store: ReleaseVerificationPersistencePort) {}

  /**
   * Records a release verification approval from a verified Trusted Verifier.
   * Deduplicates approvals by `contactId` so a single verifier cannot satisfy a
   * multi-party approval policy by submitting twice.
   */
  async submitVerifierReleaseApproval(
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    approvalEvent: ReleaseEventRecord;
    uniqueApprovalsCount: number;
    requiredApprovals: number;
  }> {
    const parsed = VerifierApprovalInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid verifier approval input."
      );
    }
    const input = parsed.data;

    const schedule = await this.store.findScheduleById(input.scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    if (schedule.state === "RELEASE_HOLD") {
      throw new ReleaseHoldActiveError();
    }

    if (schedule.state !== "VERIFICATION_REQUIRED") {
      throw new ValidationError(
        `Release approvals can only be submitted when schedule is in VERIFICATION_REQUIRED state (current: ${schedule.state}).`
      );
    }

    const contact = await this.store.findContactById(input.contactId);
    if (!contact || contact.userId !== schedule.userId) {
      throw new AuthorizationError("Contact does not belong to this estate.");
    }

    if (!canParticipateInReleaseVerification(contact)) {
      throw new AuthorizationError(
        "Contact is not a verified Trusted Verifier and cannot approve release."
      );
    }

    const existingEvents = await this.store.listReleaseEventsByScheduleId(
      schedule.id
    );

    const existingApprovalForContact = existingEvents.find(
      (e) =>
        e.eventType === "VERIFIER_APPROVED_RELEASE" &&
        e.contactId === contact.id
    );

    let approvalEvent: ReleaseEventRecord;
    if (existingApprovalForContact) {
      approvalEvent = existingApprovalForContact;
    } else {
      approvalEvent = await this.store.createReleaseEvent({
        scheduleId: schedule.id,
        userId: schedule.userId,
        contactId: contact.id,
        eventType: "VERIFIER_APPROVED_RELEASE",
        metadataJson: JSON.stringify({
          verifierEmail: contact.email,
          verificationStatement: input.verificationStatement,
          externalAdapterType: input.externalAdapterType,
          approvedAtIso: now.toISOString(),
        }),
      });

      await this.store.appendAuditEvent({
        userId: schedule.userId,
        eventType: "VERIFIER_APPROVED_RELEASE",
        severity: "CRITICAL",
        redactedMeta: JSON.stringify({
          scheduleId: schedule.id,
          contactId: contact.id,
          externalAdapterType: input.externalAdapterType,
        }),
      });
    }

    const updatedEvents = await this.store.listReleaseEventsByScheduleId(
      schedule.id
    );
    const uniqueApproverIds = new Set(
      updatedEvents
        .filter((e) => e.eventType === "VERIFIER_APPROVED_RELEASE" && e.contactId)
        .map((e) => e.contactId!)
    );

    return {
      approvalEvent,
      uniqueApprovalsCount: uniqueApproverIds.size,
      requiredApprovals: schedule.requiredVerifierApprovals,
    };
  }

  /**
   * Places an immediate Release Hold on the schedule during the verification or escalation window.
   * Can be triggered by the estate owner (`USER`) or a verified `TRUSTED_CONTACT`.
   */
  async placeReleaseHold(
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    holdEvent: ReleaseEventRecord;
  }> {
    const parsed = PlaceReleaseHoldInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid release hold parameters.");
    }
    const input = parsed.data;

    const schedule = await this.store.findScheduleById(input.scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    if (schedule.state === "RELEASED") {
      throw new ValidationError("Cannot place a hold on an already released estate.");
    }

    if (input.actorType === "USER") {
      assertResourceOwnership(schedule, input.actorId, "CheckInSchedule");
    } else {
      const contact = await this.store.findContactById(input.actorId);
      if (
        !contact ||
        contact.userId !== schedule.userId ||
        !canParticipateInReleaseVerification(contact)
      ) {
        throw new AuthorizationError(
          "Only the owner or a verified Trusted Verifier can place a Release Hold."
        );
      }
    }

    const { schedule: updated } = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: "RELEASE_HOLD",
      },
      event: {
        userId: schedule.userId,
        fromState: schedule.state,
        toState: "RELEASE_HOLD",
        reason: `RELEASE_HOLD_PLACED:${input.holdReason}`,
        idempotencyKey: `hold_${schedule.id}_v${schedule.version}_${now.getTime()}`,
        actorType: input.actorType,
        actorId: input.actorId,
      },
    });

    const holdEvent = await this.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: schedule.userId,
      contactId: input.actorType === "TRUSTED_CONTACT" ? input.actorId : null,
      eventType: "RELEASE_HOLD_PLACED",
      metadataJson: JSON.stringify({
        actorType: input.actorType,
        actorId: input.actorId,
        holdReason: input.holdReason,
      }),
    });

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: "RELEASE_HOLD_PLACED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          scheduleId: schedule.id,
          actorType: input.actorType,
          actorId: input.actorId,
          holdReason: input.holdReason,
        })
      ),
    });

    return { schedule: updated, holdEvent };
  }

  /**
   * Evaluates all fail-closed release policy rules (`THE-96` + `THE-104`) and transitions
   * the estate to `RELEASED` ONLY if every condition is met.
   */
  async authorizeEstateRelease(
    scheduleId: string,
    now = new Date()
  ): Promise<DetailedScheduleRecord> {
    const schedule = await this.store.findScheduleById(scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    if (schedule.state === "RELEASED") {
      return schedule;
    }

    const events = await this.store.listReleaseEventsByScheduleId(schedule.id);

    // Count unique verifier approvals recorded after the last check-in
    const uniqueApproverIds = new Set(
      events
        .filter(
          (e) =>
            e.eventType === "VERIFIER_APPROVED_RELEASE" &&
            e.contactId &&
            e.createdAt.getTime() >= schedule.lastCheckInAt.getTime()
        )
        .map((e) => e.contactId!)
    );

    const hasAliveSignalAfterDue = events.some(
      (e) =>
        e.eventType === "VERIFIER_ATTESTED_ALIVE" &&
        e.createdAt.getTime() >= schedule.nextDueAt.getTime()
    );

    const hasActiveHold =
      schedule.state === "RELEASE_HOLD" ||
      events.some(
        (e) =>
          e.eventType === "RELEASE_HOLD_PLACED" &&
          e.createdAt.getTime() >= schedule.lastCheckInAt.getTime()
      );

    const policyDecision = evaluateFailClosedReleasePolicy({
      currentScheduleState: schedule.state,
      missedCheckInDueAtMs: schedule.nextDueAt.getTime(),
      nowMs: now.getTime(),
      configuredGracePeriodMs: schedule.gracePeriodDays * MS_PER_DAY,
      remindersSentCount: schedule.remindersSentCount,
      minRequiredReminders: schedule.minRequiredReminders,
      hasConfirmedReminderDelivery: schedule.remindersSentCount > 0,
      userCanceledOrCheckedInAfterDue:
        schedule.lastCheckInAt.getTime() >= schedule.nextDueAt.getTime(),
      trustedContactSignaledAlive: hasAliveSignalAfterDue,
      hasActiveReleaseHold: hasActiveHold,
      requiredVerifierApprovals: schedule.requiredVerifierApprovals,
      actualVerifierApprovals: uniqueApproverIds.size,
    });

    if (!policyDecision.allowRelease) {
      throw new ReleasePolicyNotSatisfiedError(policyDecision.failClosedReasons);
    }

    const { schedule: releasedSchedule } = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: "RELEASED",
        releasedAt: now,
      },
      event: {
        userId: schedule.userId,
        fromState: schedule.state,
        toState: "RELEASED",
        reason: `ESTATE_RELEASE_AUTHORIZED_WITH_${uniqueApproverIds.size}_APPROVALS`,
        idempotencyKey: `release_auth_${schedule.id}_v${schedule.version}`,
        actorType: "SYSTEM_SCHEDULER",
        actorId: null,
      },
    });

    await this.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: schedule.userId,
      contactId: null,
      eventType: "ESTATE_RELEASE_AUTHORIZED",
      metadataJson: JSON.stringify({
        approverCount: uniqueApproverIds.size,
        releasedAtIso: now.toISOString(),
      }),
    });

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: "ESTATE_RELEASE_AUTHORIZED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        approverCount: uniqueApproverIds.size,
        releasedAtIso: now.toISOString(),
      }),
    });

    return releasedSchedule;
  }

  /**
   * Issues a time-bounded, replay-resistant Beneficiary Access Grant token
   * ONLY after the estate schedule is in the `RELEASED` state and the target contact
   * is a verified Beneficiary (`canReceiveReleasePackage`).
   */
  async issueBeneficiaryAccessGrant(params: {
    scheduleId: string;
    contactId: string;
    ttlHours?: number;
    now?: Date;
  }): Promise<{
    rawAccessToken: string;
    expiresAt: Date;
    grantEvent: ReleaseEventRecord;
  }> {
    const now = params.now ?? new Date();
    const ttlHours = params.ttlHours ?? 48;

    const schedule = await this.store.findScheduleById(params.scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    if (schedule.state !== "RELEASED") {
      throw new AuthorizationError(
        `Cannot issue beneficiary access grant while schedule is in ${schedule.state} state. Estate must be RELEASED.`
      );
    }

    const contact = await this.store.findContactById(params.contactId);
    if (!contact || contact.userId !== schedule.userId) {
      throw new AuthorizationError("Beneficiary contact not found for this estate.");
    }

    if (!canReceiveReleasePackage(contact)) {
      throw new AuthorizationError(
        "Target contact is not a verified Beneficiary with a registered public key."
      );
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    const grantEvent = await this.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: schedule.userId,
      contactId: contact.id,
      eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED",
      actionTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      metadataJson: JSON.stringify({
        beneficiaryEmail: contact.email,
        expiresAtIso: expiresAt.toISOString(),
      }),
    });

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        contactId: contact.id,
        grantEventId: grantEvent.id,
        expiresAtIso: expiresAt.toISOString(),
      }),
    });

    return {
      rawAccessToken: rawToken,
      expiresAt,
      grantEvent,
    };
  }

  /**
   * Verifies and consumes a single-use Beneficiary Access Grant token, binding it to the
   * authenticated beneficiary's email and `contactId` so replayed or stolen links fail closed.
   */
  async verifyAndConsumeBeneficiaryAccessGrant(params: {
    rawAccessToken: string;
    authenticatedBeneficiaryEmail: string;
    expectedContactId: string;
    now?: Date;
  }): Promise<{
    schedule: DetailedScheduleRecord;
    contact: ContactRecord;
    consumedGrant: ReleaseEventRecord;
  }> {
    const now = params.now ?? new Date();
    const tokenHash = hashOpaqueToken(params.rawAccessToken);
    const grant = await this.store.findReleaseEventByTokenHash(tokenHash);

    if (!grant || grant.eventType !== "BENEFICIARY_ACCESS_GRANT_ISSUED") {
      throw new AuthorizationError("Invalid beneficiary release access token.");
    }

    if (grant.tokenUsedAt !== null) {
      throw new AuthorizationError(
        "Replay detected: this beneficiary release link has already been used."
      );
    }

    if (!grant.tokenExpiresAt || grant.tokenExpiresAt.getTime() <= now.getTime()) {
      throw new AuthorizationError("Beneficiary release access token has expired.");
    }

    if (grant.contactId !== params.expectedContactId) {
      throw new AuthorizationError(
        "Horizontal access blocked: this token was not issued for this beneficiary."
      );
    }

    const schedule = await this.store.findScheduleById(grant.scheduleId);
    if (!schedule || schedule.state !== "RELEASED") {
      throw new AuthorizationError(
        "Estate is not in RELEASED state; access is denied."
      );
    }

    const contact = await this.store.findContactById(grant.contactId);
    if (!contact || !canReceiveReleasePackage(contact)) {
      throw new AuthorizationError("Beneficiary is no longer active or verified.");
    }

    if (
      contact.email.toLowerCase() !==
      params.authenticatedBeneficiaryEmail.trim().toLowerCase()
    ) {
      throw new AuthorizationError(
        "Authenticated beneficiary email does not match the verified contact owner."
      );
    }

    const consumedGrant = await this.store.markReleaseEventTokenUsed(
      grant.id,
      now
    );

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: "BENEFICIARY_ACCESS_GRANT_CONSUMED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        contactId: contact.id,
        grantEventId: grant.id,
      }),
    });

    return {
      schedule,
      contact,
      consumedGrant,
    };
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };