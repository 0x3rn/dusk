// lib/services/escalation-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
} from "../auth/security";
import { redactForAuditLog } from "../domain/trust-boundary";
import {
  canParticipateInReleaseVerification,
  type ContactRecord,
} from "./contact-service";
import type {
  DetailedScheduleRecord,
  WorkflowEventRecord,
} from "./checkin-schedule-service";
import type { NotificationChannel, NotificationStatus } from "@prisma/client";

/**
 * THE-103: Reminder Escalation, Grace Periods, Pause/Snooze & False-Trigger Cancellation
 *
 * Responsibilities:
 * 1. Multi-channel reminder cadence & SMS fallback during REMINDER_DUE, GRACE_PERIOD, and ESCALATION_PENDING.
 * 2. Provider failure isolation: failed notification deliveries do NOT increment `remindersSentCount`
 *    so a provider outage can never push a user closer to release.
 * 3. Explicit False-Trigger Cancellation (`cancelFalseTrigger`) from authenticated user sessions.
 * 4. Trusted-Contact Alive Attestation (`signalUserAliveByTrustedContact`): stops escalation and
 *    returns the workflow to HEALTHY without granting the trusted contact any vault access.
 * 5. Pause / Snooze handling (`pauseSchedule`) for travel, illness, or temporary off-grid periods.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const PauseScheduleInputSchema = z.object({
  pauseDays: z.number().int().min(1).max(180),
  reason: z.string().trim().min(3).max(240),
});

export const CancelFalseTriggerInputSchema = z.object({
  reason: z.string().trim().min(3).max(240).default("User confirmed false alarm"),
});

export const TrustedContactAliveSignalInputSchema = z.object({
  scheduleId: z.string().min(1),
  contactId: z.string().min(1),
  attestationNote: z.string().trim().min(3).max(300),
});

export interface EscalationNotificationAttempt {
  id: string;
  userId: string;
  channel: NotificationChannel;
  templateKey: string;
  recipientAddress: string;
  status: NotificationStatus;
  idempotencyKey: string;
  lastError: string | null;
}

export interface EscalationPersistencePort {
  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null>;
  findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null>;
  findContactById(contactId: string): Promise<ContactRecord | null>;
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
  recordReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    metadataJson: string;
  }): Promise<void>;
  recordNotificationAttempt(data: {
    userId: string;
    channel: NotificationChannel;
    templateKey: string;
    recipientAddress: string;
    status: NotificationStatus;
    idempotencyKey: string;
    lastError: string | null;
  }): Promise<EscalationNotificationAttempt>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export interface NotificationSenderPort {
  sendEmail(params: {
    to: string;
    templateKey: string;
  }): Promise<{ delivered: boolean; error?: string }>;
  sendSms(params: {
    to: string;
    templateKey: string;
  }): Promise<{ delivered: boolean; error?: string }>;
}

export class EscalationService {
  constructor(
    private readonly store: EscalationPersistencePort,
    private readonly sender?: NotificationSenderPort
  ) {}

  /**
   * Dispatches a check-in or escalation reminder via Email with automatic SMS fallback if Email fails
   * or if the schedule is in ESCALATION_PENDING.
   *
   * FAIL-CLOSED GUARANTEE: `remindersSentCount` is ONLY incremented if at least one channel
   * confirms delivery (`DELIVERED`). If all channels fail (provider outage), `remindersSentCount`
   * is unchanged so the user's escalation clock cannot advance toward release.
   */
  async dispatchStageReminderWithFallback(params: {
    userId: string;
    userEmail: string;
    userPhone?: string | null;
    idempotencyBaseKey: string;
    now?: Date;
  }): Promise<{
    anyDelivered: boolean;
    attempts: EscalationNotificationAttempt[];
    updatedSchedule: DetailedScheduleRecord;
  }> {
    const schedule = await this.store.findScheduleByUserId(params.userId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    if (
      schedule.state !== "REMINDER_DUE" &&
      schedule.state !== "GRACE_PERIOD" &&
      schedule.state !== "ESCALATION_PENDING"
    ) {
      return {
        anyDelivered: false,
        attempts: [],
        updatedSchedule: schedule,
      };
    }

    const templateKey = `CHECKIN_${schedule.state}_REMINDER`;
    const attempts: EscalationNotificationAttempt[] = [];
    let emailDelivered = false;
    let smsDelivered = false;

    // 1. Primary Channel: Email
    const emailResult = this.sender
      ? await this.sender.sendEmail({ to: params.userEmail, templateKey })
      : { delivered: true };

    emailDelivered = emailResult.delivered;
    attempts.push(
      await this.store.recordNotificationAttempt({
        userId: params.userId,
        channel: "EMAIL",
        templateKey,
        recipientAddress: params.userEmail,
        status: emailDelivered ? "DELIVERED" : "FAILED",
        idempotencyKey: `${params.idempotencyBaseKey}:EMAIL`,
        lastError: emailResult.error ?? null,
      })
    );

    // 2. Fallback / Escalation Channel: SMS (triggered if Email failed OR if in ESCALATION_PENDING)
    const shouldSendSms =
      Boolean(params.userPhone) &&
      (!emailDelivered || schedule.state === "ESCALATION_PENDING");

    if (shouldSendSms && params.userPhone) {
      const smsResult = this.sender
        ? await this.sender.sendSms({ to: params.userPhone, templateKey })
        : { delivered: true };

      smsDelivered = smsResult.delivered;
      attempts.push(
        await this.store.recordNotificationAttempt({
          userId: params.userId,
          channel: "SMS",
          templateKey,
          recipientAddress: params.userPhone,
          status: smsDelivered ? "DELIVERED" : "FAILED",
          idempotencyKey: `${params.idempotencyBaseKey}:SMS`,
          lastError: smsResult.error ?? null,
        })
      );
    }

    const anyDelivered = emailDelivered || smsDelivered;
    if (!anyDelivered) {
      await this.store.appendAuditEvent({
        userId: params.userId,
        eventType: "REMINDER_DELIVERY_OUTAGE_DETECTED",
        severity: "WARN",
        redactedMeta: JSON.stringify({
          scheduleId: schedule.id,
          state: schedule.state,
          idempotencyBaseKey: params.idempotencyBaseKey,
        }),
      });
      return {
        anyDelivered: false,
        attempts,
        updatedSchedule: schedule,
      };
    }

    const { schedule: updatedSchedule } = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        remindersSentCount: schedule.remindersSentCount + 1,
      },
      event: {
        userId: schedule.userId,
        fromState: schedule.state,
        toState: schedule.state,
        reason: `REMINDER_DELIVERED_${emailDelivered ? "EMAIL" : ""}${
          smsDelivered ? "_SMS" : ""
        }`,
        idempotencyKey: `${params.idempotencyBaseKey}:DELIVERY_RECORDED`,
        actorType: "SYSTEM_SCHEDULER",
        actorId: null,
      },
    });

    return {
      anyDelivered: true,
      attempts,
      updatedSchedule,
    };
  }

  /**
   * Explicit False-Trigger Cancellation from an authenticated user session.
   * Stops any active grace period, escalation, verification, or hold and returns the
   * workflow to a healthy scheduled state while preserving full event history.
   */
  async cancelFalseTrigger(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const parsed = CancelFalseTriggerInputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      throw new ValidationError("Invalid false-trigger cancellation reason.");
    }

    const schedule = assertResourceOwnership(
      await this.store.findScheduleByUserId(authenticatedUserId),
      authenticatedUserId,
      "CheckInSchedule"
    );

    if (schedule.state === "RELEASED") {
      throw new ValidationError(
        "Cannot cancel false trigger after estate has already been released."
      );
    }

    const previousState = schedule.state;
    const nextDueAt = new Date(
      now.getTime() + schedule.intervalDays * MS_PER_DAY
    );

    const result = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: "HEALTHY",
        lastCheckInAt: now,
        nextDueAt,
        graceEndsAt: null,
        pausedUntil: null,
        remindersSentCount: 0,
      },
      event: {
        userId: authenticatedUserId,
        fromState: previousState,
        toState: "HEALTHY",
        reason: `FALSE_TRIGGER_CANCELED:${parsed.data.reason}`,
        idempotencyKey: `cancel_${schedule.id}_v${schedule.version}_${now.getTime()}`,
        actorType: "USER",
        actorId: authenticatedUserId,
      },
    });

    await this.store.recordReleaseEvent({
      scheduleId: schedule.id,
      userId: authenticatedUserId,
      contactId: null,
      eventType: "FALSE_TRIGGER_CANCELED_BY_OWNER",
      metadataJson: JSON.stringify({
        previousState,
        reason: parsed.data.reason,
      }),
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "FALSE_TRIGGER_CANCELED",
      severity: "WARN",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          scheduleId: schedule.id,
          previousState,
          reason: parsed.data.reason,
        })
      ),
    });

    return result;
  }

  /**
   * Allows a verified Trusted Verifier (`isTrustedVerifier === true`) to signal that the
   * user is known to be alive during ESCALATION_PENDING or VERIFICATION_REQUIRED.
   *
   * SECURITY INVARIANT: This stops escalation and returns the schedule to HEALTHY,
   * and NEVER returns or grants access to any vault items or keys.
   */
  async signalUserAliveByTrustedContact(
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    const parsed = TrustedContactAliveSignalInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid trusted-contact alive attestation payload.");
    }
    const input = parsed.data;

    const schedule = await this.store.findScheduleById(input.scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    const contact = await this.store.findContactById(input.contactId);
    if (!contact || contact.userId !== schedule.userId) {
      throw new AuthorizationError(
        "Contact does not belong to this estate owner."
      );
    }

    if (!canParticipateInReleaseVerification(contact)) {
      throw new AuthorizationError(
        "Only verified Trusted Verifier contacts can submit an alive attestation."
      );
    }

    if (
      schedule.state !== "GRACE_PERIOD" &&
      schedule.state !== "ESCALATION_PENDING" &&
      schedule.state !== "VERIFICATION_REQUIRED" &&
      schedule.state !== "RELEASE_HOLD"
    ) {
      throw new ValidationError(
        `Cannot submit alive signal when schedule is in ${schedule.state} state.`
      );
    }

    const previousState = schedule.state;
    const nextDueAt = new Date(
      now.getTime() + schedule.intervalDays * MS_PER_DAY
    );

    const result = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: "HEALTHY",
        lastCheckInAt: now,
        nextDueAt,
        graceEndsAt: null,
        remindersSentCount: 0,
      },
      event: {
        userId: schedule.userId,
        fromState: previousState,
        toState: "HEALTHY",
        reason: `TRUSTED_CONTACT_ATTESTED_ALIVE:${contact.id}`,
        idempotencyKey: `alive_${schedule.id}_v${schedule.version}_${contact.id}`,
        actorType: "TRUSTED_CONTACT",
        actorId: contact.id,
      },
    });

    await this.store.recordReleaseEvent({
      scheduleId: schedule.id,
      userId: schedule.userId,
      contactId: contact.id,
      eventType: "VERIFIER_ATTESTED_ALIVE",
      metadataJson: JSON.stringify({
        contactEmail: contact.email,
        attestationNote: input.attestationNote,
        previousState,
      }),
    });

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: "TRUSTED_CONTACT_SIGNALED_ALIVE",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        contactId: contact.id,
        previousState,
      }),
    });

    return result;
  }

  /**
   * Pauses / snoozes the check-in schedule for travel, illness, or temporary off-grid periods.
   */
  async pauseSchedule(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const parsed = PauseScheduleInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid pause duration or reason."
      );
    }
    const input = parsed.data;

    const schedule = assertResourceOwnership(
      await this.store.findScheduleByUserId(authenticatedUserId),
      authenticatedUserId,
      "CheckInSchedule"
    );

    if (schedule.state === "RELEASED") {
      throw new ValidationError("Cannot pause an already released schedule.");
    }

    const pausedUntil = new Date(
      now.getTime() + input.pauseDays * MS_PER_DAY
    );
    const nextDueAt = new Date(
      pausedUntil.getTime() + schedule.intervalDays * MS_PER_DAY
    );

    const result = await this.store.updateScheduleState({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: "PAUSED",
        pausedUntil,
        nextDueAt,
        graceEndsAt: null,
        remindersSentCount: 0,
      },
      event: {
        userId: authenticatedUserId,
        fromState: schedule.state,
        toState: "PAUSED",
        reason: `USER_PAUSED:${input.reason}`,
        idempotencyKey: `pause_${schedule.id}_v${schedule.version}_${now.getTime()}`,
        actorType: "USER",
        actorId: authenticatedUserId,
      },
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "CHECKIN_SCHEDULE_PAUSED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        pauseDays: input.pauseDays,
        pausedUntilIso: pausedUntil.toISOString(),
      }),
    });

    return result;
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };