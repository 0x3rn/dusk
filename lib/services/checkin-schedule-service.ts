// lib/services/checkin-schedule-service.ts
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
import type { ScheduleState } from "@prisma/client";

/**
 * THE-102: Proof-of-Life Schedules & Check-In State Machine
 *
 * Invariants:
 * 1. A missed reminder or scheduler tick NEVER transitions directly to `RELEASED`.
 *    The furthest a timer tick can advance the state machine is `VERIFICATION_REQUIRED`,
 *    and only step-by-step (`HEALTHY` -> `REMINDER_DUE` -> `GRACE_PERIOD` -> `ESCALATION_PENDING` -> `VERIFICATION_REQUIRED`).
 * 2. Every scheduler transition is idempotent via `idempotencyKey` and guarded by optimistic concurrency `version`.
 * 3. A valid check-in (authenticated in-app or single-use signed check-in token) immediately resets
 *    any non-RELEASED state (`REMINDER_DUE`, `GRACE_PERIOD`, `ESCALATION_PENDING`, `VERIFICATION_REQUIRED`, `RELEASE_HOLD`, `PAUSED`)
 *    back to `HEALTHY` and recalculates `nextDueAt`.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const ConfigureScheduleInputSchema = z
  .object({
    intervalDays: z.number().int().min(7).max(365),
    gracePeriodDays: z.number().int().min(3).max(90),
    reminderDaysBeforeDue: z.number().int().min(1).max(30),
    minRequiredReminders: z.number().int().min(2).max(10).default(3),
    requiredVerifierApprovals: z.number().int().min(1).max(10).default(1),
  })
  .refine((cfg) => cfg.reminderDaysBeforeDue < cfg.intervalDays, {
    message: "reminderDaysBeforeDue must be less than intervalDays.",
  });

export interface DetailedScheduleRecord {
  id: string;
  userId: string;
  state: ScheduleState;
  intervalDays: number;
  gracePeriodDays: number;
  reminderDaysBeforeDue: number;
  minRequiredReminders: number;
  remindersSentCount: number;
  requiredVerifierApprovals: number;
  lastCheckInAt: Date;
  nextDueAt: Date;
  graceEndsAt: Date | null;
  pausedUntil: Date | null;
  releasedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowEventRecord {
  id: string;
  scheduleId: string;
  userId: string;
  fromState: ScheduleState;
  toState: ScheduleState;
  reason: string;
  idempotencyKey: string;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

export interface SingleUseCheckInTokenRecord {
  id: string;
  scheduleId: string;
  userId: string;
  actionTokenHash: string;
  tokenExpiresAt: Date;
  tokenUsedAt: Date | null;
}

export interface CheckInSchedulePersistencePort {
  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null>;
  findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null>;
  findWorkflowEventByIdempotencyKey(
    idempotencyKey: string
  ): Promise<WorkflowEventRecord | null>;
  updateScheduleWithVersionCheck(params: {
    scheduleId: string;
    expectedVersion: number;
    data: Partial<
      Omit<DetailedScheduleRecord, "id" | "userId" | "version" | "createdAt" | "updatedAt">
    >;
    event: {
      userId: string;
      fromState: ScheduleState;
      toState: ScheduleState;
      reason: string;
      idempotencyKey: string;
      actorType: "USER" | "SYSTEM_SCHEDULER" | "TRUSTED_CONTACT";
      actorId: string | null;
    };
  }): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }>;
  createSingleUseCheckInToken(data: {
    scheduleId: string;
    userId: string;
    actionTokenHash: string;
    tokenExpiresAt: Date;
  }): Promise<SingleUseCheckInTokenRecord>;
  findSingleUseCheckInTokenByHash(
    tokenHash: string
  ): Promise<SingleUseCheckInTokenRecord | null>;
  markSingleUseCheckInTokenUsed(
    tokenId: string,
    usedAt: Date
  ): Promise<SingleUseCheckInTokenRecord>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class ConcurrencyConflictError extends Error {
  public readonly code = "CONCURRENCY_CONFLICT";
  constructor(
    message = "Schedule state was modified concurrently. Refresh and retry."
  ) {
    super(message);
    this.name = "ConcurrencyConflictError";
  }
}

/**
 * Pure state-calculation helper: determines what the next single stage should be
 * when a scheduler job evaluates a schedule at `now`.
 *
 * CRITICAL RULE: A single scheduler tick can only advance ONE stage at a time
 * and can NEVER return `RELEASED`.
 */
export function computeNextSchedulerStage(params: {
  schedule: DetailedScheduleRecord;
  now: Date;
  hasConfirmedReminderDelivery?: boolean;
}): {
  shouldTransition: boolean;
  nextState: ScheduleState;
  reason: string;
  computedGraceEndsAt: Date | null;
} {
  const { schedule, now } = params;
  const nowMs = now.getTime();

  // Terminal or held states do not advance on timer ticks
  if (
    schedule.state === "RELEASED" ||
    schedule.state === "RELEASE_HOLD" ||
    schedule.state === "VERIFICATION_REQUIRED" ||
    schedule.state === "CANCELED"
  ) {
    return {
      shouldTransition: false,
      nextState: schedule.state,
      reason: `NO_OP_IN_STATE_${schedule.state}`,
      computedGraceEndsAt: schedule.graceEndsAt,
    };
  }

  // If paused and pause window has not expired, do not advance
  if (schedule.state === "PAUSED") {
    if (schedule.pausedUntil && nowMs < schedule.pausedUntil.getTime()) {
      return {
        shouldTransition: false,
        nextState: "PAUSED",
        reason: "SCHEDULE_PAUSED",
        computedGraceEndsAt: schedule.graceEndsAt,
      };
    }
    // Pause expired -> return to HEALTHY with a fresh due window from pause end
    return {
      shouldTransition: true,
      nextState: "HEALTHY",
      reason: "PAUSE_WINDOW_EXPIRED_RESUMED_HEALTHY",
      computedGraceEndsAt: null,
    };
  }

  const nextDueMs = schedule.nextDueAt.getTime();
  const reminderStartMs =
    nextDueMs - schedule.reminderDaysBeforeDue * MS_PER_DAY;
  const graceEndsMs =
    schedule.graceEndsAt?.getTime() ??
    nextDueMs + schedule.gracePeriodDays * MS_PER_DAY;

  if (schedule.state === "HEALTHY") {
    if (nowMs >= reminderStartMs) {
      return {
        shouldTransition: true,
        nextState: "REMINDER_DUE",
        reason: "ENTERED_PRE_DUE_REMINDER_WINDOW",
        computedGraceEndsAt: new Date(
          nextDueMs + schedule.gracePeriodDays * MS_PER_DAY
        ),
      };
    }
    return {
      shouldTransition: false,
      nextState: "HEALTHY",
      reason: "STILL_HEALTHY",
      computedGraceEndsAt: schedule.graceEndsAt,
    };
  }

  if (schedule.state === "REMINDER_DUE") {
    if (nowMs >= nextDueMs) {
      return {
        shouldTransition: true,
        nextState: "GRACE_PERIOD",
        reason: "CHECK_IN_DUE_DATE_PASSED_ENTERING_GRACE_PERIOD",
        computedGraceEndsAt: new Date(
          nextDueMs + schedule.gracePeriodDays * MS_PER_DAY
        ),
      };
    }
    return {
      shouldTransition: false,
      nextState: "REMINDER_DUE",
      reason: "AWAITING_DUE_DATE",
      computedGraceEndsAt: schedule.graceEndsAt,
    };
  }

  if (schedule.state === "GRACE_PERIOD") {
    // Only advance to ESCALATION_PENDING after grace period elapses AND at least 1 reminder was sent
    if (nowMs >= graceEndsMs && schedule.remindersSentCount >= 1) {
      return {
        shouldTransition: true,
        nextState: "ESCALATION_PENDING",
        reason: "GRACE_PERIOD_ELAPSED_ESCALATING_TO_MULTI_CHANNEL_WARNINGS",
        computedGraceEndsAt: new Date(graceEndsMs),
      };
    }
    return {
      shouldTransition: false,
      nextState: "GRACE_PERIOD",
      reason: "IN_GRACE_PERIOD_OR_AWAITING_INITIAL_REMINDER",
      computedGraceEndsAt: new Date(graceEndsMs),
    };
  }

  if (schedule.state === "ESCALATION_PENDING") {
    const escalationWindowEndsMs = graceEndsMs + 7 * MS_PER_DAY;
    const hasEnoughReminders =
      schedule.remindersSentCount >= schedule.minRequiredReminders;
    const deliveryConfirmed = params.hasConfirmedReminderDelivery ?? true;

    if (
      nowMs >= escalationWindowEndsMs &&
      hasEnoughReminders &&
      deliveryConfirmed
    ) {
      return {
        shouldTransition: true,
        nextState: "VERIFICATION_REQUIRED",
        reason: "ESCALATION_EXHAUSTED_ENTERING_RELEASE_VERIFICATION",
        computedGraceEndsAt: new Date(graceEndsMs),
      };
    }
    return {
      shouldTransition: false,
      nextState: "ESCALATION_PENDING",
      reason: "AWAITING_ESCALATION_REMINDERS_OR_DELIVERY_CONFIRMATION",
      computedGraceEndsAt: new Date(graceEndsMs),
    };
  }

  return {
    shouldTransition: false,
    nextState: schedule.state,
    reason: "NO_TRANSITION",
    computedGraceEndsAt: schedule.graceEndsAt,
  };
}

export class CheckInScheduleService {
  constructor(private readonly store: CheckInSchedulePersistencePort) {}

  /**
   * Updates the user's check-in interval, grace period, and reminder settings.
   */
  async updateScheduleConfiguration(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown,
    now = new Date()
  ): Promise<DetailedScheduleRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const parsed = ConfigureScheduleInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid schedule configuration."
      );
    }
    const input = parsed.data;

    const schedule = assertResourceOwnership(
      await this.store.findScheduleByUserId(authenticatedUserId),
      authenticatedUserId,
      "CheckInSchedule"
    );

    if (schedule.state === "RELEASED") {
      throw new ValidationError("Cannot reconfigure a schedule that has already been released.");
    }

    const nextDueAt = new Date(
      now.getTime() + input.intervalDays * MS_PER_DAY
    );

    const { schedule: updated } = await this.store.updateScheduleWithVersionCheck({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        intervalDays: input.intervalDays,
        gracePeriodDays: input.gracePeriodDays,
        reminderDaysBeforeDue: input.reminderDaysBeforeDue,
        minRequiredReminders: input.minRequiredReminders,
        requiredVerifierApprovals: input.requiredVerifierApprovals,
        state: "HEALTHY",
        lastCheckInAt: now,
        nextDueAt,
        graceEndsAt: null,
        remindersSentCount: 0,
      },
      event: {
        userId: authenticatedUserId,
        fromState: schedule.state,
        toState: "HEALTHY",
        reason: "SCHEDULE_CONFIGURATION_UPDATED",
        idempotencyKey: `cfg_${schedule.id}_v${schedule.version}_${now.getTime()}`,
        actorType: "USER",
        actorId: authenticatedUserId,
      },
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "CHECKIN_SCHEDULE_CONFIGURED",
      severity: "INFO",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          scheduleId: updated.id,
          intervalDays: updated.intervalDays,
          gracePeriodDays: updated.gracePeriodDays,
          reminderDaysBeforeDue: updated.reminderDaysBeforeDue,
        })
      ),
    });

    return updated;
  }

  /**
   * Performs an authenticated in-app Proof-of-Life Check-In.
   * Immediately resets any pending reminder, grace period, escalation, or verification state back to HEALTHY.
   */
  async recordAuthenticatedCheckIn(
    authenticatedUserId: string | null | undefined,
    idempotencyKey?: string,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const schedule = assertResourceOwnership(
      await this.store.findScheduleByUserId(authenticatedUserId),
      authenticatedUserId,
      "CheckInSchedule"
    );

    if (schedule.state === "RELEASED") {
      throw new ValidationError("Vault has already been released.");
    }

    const key =
      idempotencyKey ?? `checkin_auth_${schedule.id}_v${schedule.version}`;
    const existingEvent =
      await this.store.findWorkflowEventByIdempotencyKey(key);
    if (existingEvent) {
      return { schedule, workflowEvent: existingEvent };
    }

    const nextDueAt = new Date(
      now.getTime() + schedule.intervalDays * MS_PER_DAY
    );

    const result = await this.store.updateScheduleWithVersionCheck({
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
        fromState: schedule.state,
        toState: "HEALTHY",
        reason: "USER_AUTHENTICATED_PROOF_OF_LIFE",
        idempotencyKey: key,
        actorType: "USER",
        actorId: authenticatedUserId,
      },
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "PROOF_OF_LIFE_CHECKIN_CONFIRMED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        previousState: schedule.state,
        nextDueAtIso: nextDueAt.toISOString(),
      }),
    });

    return result;
  }

  /**
   * Issues a signed, single-use Check-In link token so a user can confirm Proof-of-Life
   * from an email/SMS reminder link.
   */
  async issueSingleUseCheckInToken(
    authenticatedOrSystemUserId: string,
    now = new Date(),
    ttlHours = 72
  ): Promise<{ rawCheckInToken: string; expiresAt: Date }> {
    const schedule = await this.store.findScheduleByUserId(
      authenticatedOrSystemUserId
    );
    if (!schedule) {
      throw new ValidationError("Schedule not found for user.");
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

    await this.store.createSingleUseCheckInToken({
      scheduleId: schedule.id,
      userId: schedule.userId,
      actionTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
    });

    return { rawCheckInToken: rawToken, expiresAt };
  }

  /**
   * Consumes a single-use Check-In link token and resets the workflow to HEALTHY.
   * Replayed or expired tokens fail closed.
   */
  async confirmCheckInWithSingleUseToken(
    rawToken: string,
    now = new Date()
  ): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    const tokenHash = hashOpaqueToken(rawToken);
    const tokenRecord =
      await this.store.findSingleUseCheckInTokenByHash(tokenHash);

    if (!tokenRecord) {
      throw new AuthorizationError("Invalid check-in link token.");
    }
    if (tokenRecord.tokenUsedAt !== null) {
      throw new AuthorizationError(
        "This single-use check-in link has already been used."
      );
    }
    if (tokenRecord.tokenExpiresAt.getTime() <= now.getTime()) {
      throw new AuthorizationError("This check-in link has expired.");
    }

    await this.store.markSingleUseCheckInTokenUsed(tokenRecord.id, now);

    return this.recordAuthenticatedCheckIn(
      tokenRecord.userId,
      `checkin_token_${tokenRecord.id}`,
      now
    );
  }

  /**
   * Executes an idempotent scheduler evaluation tick for a user's schedule.
   * Duplicate job runs with the same `jobIdempotencyKey` are safe no-ops.
   */
  async evaluateScheduleOnTimerTick(params: {
    scheduleId: string;
    jobIdempotencyKey: string;
    now?: Date;
    hasConfirmedReminderDelivery?: boolean;
  }): Promise<{
    transitioned: boolean;
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord | null;
  }> {
    const now = params.now ?? new Date();
    const existingEvent =
      await this.store.findWorkflowEventByIdempotencyKey(
        params.jobIdempotencyKey
      );

    const schedule = await this.store.findScheduleById(params.scheduleId);
    if (!schedule) {
      throw new ValidationError("Schedule not found.");
    }

    // Idempotent duplicate job protection
    if (existingEvent) {
      return {
        transitioned: false,
        schedule,
        workflowEvent: existingEvent,
      };
    }

    const decision = computeNextSchedulerStage({
      schedule,
      now,
      hasConfirmedReminderDelivery: params.hasConfirmedReminderDelivery,
    });

    if (!decision.shouldTransition) {
      return {
        transitioned: false,
        schedule,
        workflowEvent: null,
      };
    }

    const nextDueAt =
      decision.nextState === "HEALTHY"
        ? new Date(now.getTime() + schedule.intervalDays * MS_PER_DAY)
        : schedule.nextDueAt;

    const updated = await this.store.updateScheduleWithVersionCheck({
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
      data: {
        state: decision.nextState,
        nextDueAt,
        graceEndsAt: decision.computedGraceEndsAt,
        pausedUntil: decision.nextState === "HEALTHY" ? null : schedule.pausedUntil,
      },
      event: {
        userId: schedule.userId,
        fromState: schedule.state,
        toState: decision.nextState,
        reason: decision.reason,
        idempotencyKey: params.jobIdempotencyKey,
        actorType: "SYSTEM_SCHEDULER",
        actorId: null,
      },
    });

    await this.store.appendAuditEvent({
      userId: schedule.userId,
      eventType: `WORKFLOW_STATE_${decision.nextState}`,
      severity:
        decision.nextState === "VERIFICATION_REQUIRED" ||
        decision.nextState === "ESCALATION_PENDING"
          ? "WARN"
          : "INFO",
      redactedMeta: JSON.stringify({
        scheduleId: schedule.id,
        fromState: schedule.state,
        toState: decision.nextState,
        reason: decision.reason,
      }),
    });

    return {
      transitioned: true,
      schedule: updated.schedule,
      workflowEvent: updated.workflowEvent,
    };
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };