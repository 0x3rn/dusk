// lib/services/checkin-schedule-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthorizationError,
  CheckInScheduleService,
  ConcurrencyConflictError,
  ValidationError,
  type CheckInSchedulePersistencePort,
  type DetailedScheduleRecord,
  type SingleUseCheckInTokenRecord,
  type WorkflowEventRecord,
} from "./checkin-schedule-service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

class InMemoryCheckInScheduleStore implements CheckInSchedulePersistencePort {
  public schedules = new Map<string, DetailedScheduleRecord>();
  public workflowEvents = new Map<string, WorkflowEventRecord>();
  public tokens = new Map<string, SingleUseCheckInTokenRecord>();
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  seedSchedule(userId: string, now: Date): DetailedScheduleRecord {
    const record: DetailedScheduleRecord = {
      id: `sch_${crypto.randomUUID()}`,
      userId,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 0,
      requiredVerifierApprovals: 1,
      lastCheckInAt: now,
      nextDueAt: new Date(now.getTime() + 90 * MS_PER_DAY),
      graceEndsAt: null,
      pausedUntil: null,
      releasedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(record.id, record);
    return record;
  }

  async findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null> {
    for (const s of this.schedules.values()) {
      if (s.userId === userId) return s;
    }
    return null;
  }

  async findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null> {
    return this.schedules.get(scheduleId) ?? null;
  }

  async findWorkflowEventByIdempotencyKey(
    idempotencyKey: string
  ): Promise<WorkflowEventRecord | null> {
    return this.workflowEvents.get(idempotencyKey) ?? null;
  }

  async updateScheduleWithVersionCheck(params: {
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
  }> {
    const existing = this.schedules.get(params.scheduleId);
    if (!existing) throw new Error("Schedule not found");

    if (existing.version !== params.expectedVersion) {
      throw new ConcurrencyConflictError();
    }

    const updated: DetailedScheduleRecord = {
      ...existing,
      ...params.data,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.schedules.set(updated.id, updated);

    const wfEvent: WorkflowEventRecord = {
      id: `wfe_${crypto.randomUUID()}`,
      scheduleId: updated.id,
      userId: params.event.userId,
      fromState: params.event.fromState,
      toState: params.event.toState,
      reason: params.event.reason,
      idempotencyKey: params.event.idempotencyKey,
      actorType: params.event.actorType,
      actorId: params.event.actorId,
      createdAt: new Date(),
    };
    this.workflowEvents.set(wfEvent.idempotencyKey, wfEvent);

    return { schedule: updated, workflowEvent: wfEvent };
  }

  async createSingleUseCheckInToken(data: {
    scheduleId: string;
    userId: string;
    actionTokenHash: string;
    tokenExpiresAt: Date;
  }): Promise<SingleUseCheckInTokenRecord> {
    const rec: SingleUseCheckInTokenRecord = {
      id: `tok_${crypto.randomUUID()}`,
      ...data,
      tokenUsedAt: null,
    };
    this.tokens.set(rec.actionTokenHash, rec);
    return rec;
  }

  async findSingleUseCheckInTokenByHash(
    tokenHash: string
  ): Promise<SingleUseCheckInTokenRecord | null> {
    return this.tokens.get(tokenHash) ?? null;
  }

  async markSingleUseCheckInTokenUsed(
    tokenId: string,
    usedAt: Date
  ): Promise<SingleUseCheckInTokenRecord> {
    for (const [hash, rec] of this.tokens.entries()) {
      if (rec.id === tokenId) {
        const updated = { ...rec, tokenUsedAt: usedAt };
        this.tokens.set(hash, updated);
        return updated;
      }
    }
    throw new Error("Token not found");
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

describe("THE-102: Proof-of-Life Schedules & Check-In State Machine", () => {
  let store: InMemoryCheckInScheduleStore;
  let service: CheckInScheduleService;
  const userId = "usr_checkin_owner";
  const t0 = new Date("2026-01-01T00:00:00Z");

  beforeEach(() => {
    store = new InMemoryCheckInScheduleStore();
    service = new CheckInScheduleService(store);
  });

  it("1. advances step-by-step through HEALTHY -> REMINDER_DUE -> GRACE_PERIOD -> ESCALATION_PENDING -> VERIFICATION_REQUIRED and NEVER directly to RELEASED", async () => {
    const initial = store.seedSchedule(userId, t0);

    // Day 30: still HEALTHY
    const day30 = new Date(t0.getTime() + 30 * MS_PER_DAY);
    const tick1 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_30",
      now: day30,
    });
    expect(tick1.transitioned).toBe(false);
    expect(tick1.schedule.state).toBe("HEALTHY");

    // Day 84 (6 days before 90-day due date; inside 7-day reminder window): HEALTHY -> REMINDER_DUE
    const day84 = new Date(t0.getTime() + 84 * MS_PER_DAY);
    const tick2 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_84",
      now: day84,
    });
    expect(tick2.transitioned).toBe(true);
    expect(tick2.schedule.state).toBe("REMINDER_DUE");

    // Day 91 (past 90-day due date): REMINDER_DUE -> GRACE_PERIOD
    const day91 = new Date(t0.getTime() + 91 * MS_PER_DAY);
    const tick3 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_91",
      now: day91,
    });
    expect(tick3.transitioned).toBe(true);
    expect(tick3.schedule.state).toBe("GRACE_PERIOD");

    // Day 105 (past 14-day grace period), but remindersSentCount is still 0 -> FAILS CLOSED (stays in GRACE_PERIOD)
    const day105 = new Date(t0.getTime() + 105 * MS_PER_DAY);
    const tickBlocked = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_105_no_reminders",
      now: day105,
    });
    expect(tickBlocked.transitioned).toBe(false);
    expect(tickBlocked.schedule.state).toBe("GRACE_PERIOD");

    // Record 1 reminder sent -> now GRACE_PERIOD -> ESCALATION_PENDING
    store.schedules.set(initial.id, {
      ...store.schedules.get(initial.id)!,
      remindersSentCount: 1,
    });
    const tick4 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_105_with_reminder",
      now: day105,
    });
    expect(tick4.transitioned).toBe(true);
    expect(tick4.schedule.state).toBe("ESCALATION_PENDING");

    // Day 115 (past 7-day escalation window) with 3 confirmed reminders -> ESCALATION_PENDING -> VERIFICATION_REQUIRED
    store.schedules.set(initial.id, {
      ...store.schedules.get(initial.id)!,
      remindersSentCount: 3,
    });
    const day115 = new Date(t0.getTime() + 115 * MS_PER_DAY);
    const tick5 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_115",
      now: day115,
      hasConfirmedReminderDelivery: true,
    });
    expect(tick5.transitioned).toBe(true);
    expect(tick5.schedule.state).toBe("VERIFICATION_REQUIRED");

    // Day 200: Further timer ticks NEVER transition from VERIFICATION_REQUIRED to RELEASED
    const day200 = new Date(t0.getTime() + 200 * MS_PER_DAY);
    const tick6 = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "job_day_200",
      now: day200,
    });
    expect(tick6.transitioned).toBe(false);
    expect(tick6.schedule.state).toBe("VERIFICATION_REQUIRED");
  });

  it("2. guarantees idempotency: duplicate scheduler runs cannot advance the workflow twice", async () => {
    const initial = store.seedSchedule(userId, t0);
    // Jump to Day 95 (past due date, even though schedule is still in HEALTHY)
    const day95 = new Date(t0.getTime() + 95 * MS_PER_DAY);

    // First run advances HEALTHY -> REMINDER_DUE (one stage at a time)
    const firstRun = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "cron_2026_04_06",
      now: day95,
    });
    expect(firstRun.transitioned).toBe(true);
    expect(firstRun.schedule.state).toBe("REMINDER_DUE");
    const versionAfterFirst = firstRun.schedule.version;

    // Duplicate run with the exact same jobIdempotencyKey is a safe no-op!
    const duplicateRun = await service.evaluateScheduleOnTimerTick({
      scheduleId: initial.id,
      jobIdempotencyKey: "cron_2026_04_06",
      now: day95,
    });
    expect(duplicateRun.transitioned).toBe(false);
    expect(duplicateRun.schedule.state).toBe("REMINDER_DUE");
    expect(duplicateRun.schedule.version).toBe(versionAfterFirst);
  });

  it("3. resets pending escalation immediately on authenticated check-in or single-use check-in token and blocks token replay", async () => {
    const initial = store.seedSchedule(userId, t0);
    // Put schedule in ESCALATION_PENDING
    store.schedules.set(initial.id, {
      ...initial,
      state: "ESCALATION_PENDING",
      remindersSentCount: 2,
      graceEndsAt: new Date(t0.getTime() + 104 * MS_PER_DAY),
    });

    const checkInTime = new Date(t0.getTime() + 106 * MS_PER_DAY);

    // Issue a single-use check-in token
    const { rawCheckInToken } = await service.issueSingleUseCheckInToken(
      userId,
      checkInTime,
      24
    );

    // Confirm check-in via single-use token -> immediately resets to HEALTHY
    const confirmed = await service.confirmCheckInWithSingleUseToken(
      rawCheckInToken,
      checkInTime
    );
    expect(confirmed.schedule.state).toBe("HEALTHY");
    expect(confirmed.schedule.remindersSentCount).toBe(0);
    expect(confirmed.schedule.graceEndsAt).toBeNull();
    expect(confirmed.schedule.nextDueAt.getTime()).toBe(
      checkInTime.getTime() + 90 * MS_PER_DAY
    );

    // Replaying the same single-use check-in token fails closed
    await expect(
      service.confirmCheckInWithSingleUseToken(rawCheckInToken, checkInTime)
    ).rejects.toThrowError(AuthorizationError);
  });

  it("4. validates custom schedule intervals and rejects invalid configurations", async () => {
    store.seedSchedule(userId, t0);

    // Rejects reminderDaysBeforeDue >= intervalDays
    await expect(
      service.updateScheduleConfiguration(userId, {
        intervalDays: 14,
        gracePeriodDays: 7,
        reminderDaysBeforeDue: 14,
        minRequiredReminders: 3,
        requiredVerifierApprovals: 1,
      })
    ).rejects.toThrowError(ValidationError);

    // Accepts valid monthly (30-day) schedule configuration
    const updated = await service.updateScheduleConfiguration(
      userId,
      {
        intervalDays: 30,
        gracePeriodDays: 10,
        reminderDaysBeforeDue: 5,
        minRequiredReminders: 3,
        requiredVerifierApprovals: 2,
      },
      t0
    );
    expect(updated.intervalDays).toBe(30);
    expect(updated.gracePeriodDays).toBe(10);
    expect(updated.requiredVerifierApprovals).toBe(2);
  });
});