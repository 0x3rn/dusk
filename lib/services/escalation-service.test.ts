// lib/services/escalation-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthorizationError,
  EscalationService,
  ValidationError,
  type EscalationNotificationAttempt,
  type EscalationPersistencePort,
} from "./escalation-service";
import type { ContactRecord } from "./contact-service";
import type {
  DetailedScheduleRecord,
  WorkflowEventRecord,
} from "./checkin-schedule-service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

class InMemoryEscalationStore implements EscalationPersistencePort {
  public schedules = new Map<string, DetailedScheduleRecord>();
  public contacts = new Map<string, ContactRecord>();
  public workflowEvents: WorkflowEventRecord[] = [];
  public releaseEvents: Array<{
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    metadataJson: string;
  }> = [];
  public notifications: EscalationNotificationAttempt[] = [];
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  seedSchedule(
    userId: string,
    state: DetailedScheduleRecord["state"],
    now: Date
  ): DetailedScheduleRecord {
    const rec: DetailedScheduleRecord = {
      id: `sch_${crypto.randomUUID()}`,
      userId,
      state,
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 1,
      requiredVerifierApprovals: 1,
      lastCheckInAt: new Date(now.getTime() - 100 * MS_PER_DAY),
      nextDueAt: new Date(now.getTime() - 10 * MS_PER_DAY),
      graceEndsAt: new Date(now.getTime() + 4 * MS_PER_DAY),
      pausedUntil: null,
      releasedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(rec.id, rec);
    return rec;
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

  async findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async updateScheduleState(params: {
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
    const existing = this.schedules.get(params.scheduleId)!;
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
    this.workflowEvents.push(wfEvent);

    return { schedule: updated, workflowEvent: wfEvent };
  }

  async recordReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    metadataJson: string;
  }): Promise<void> {
    this.releaseEvents.push(data);
  }

  async recordNotificationAttempt(data: {
    userId: string;
    channel: EscalationNotificationAttempt["channel"];
    templateKey: string;
    recipientAddress: string;
    status: EscalationNotificationAttempt["status"];
    idempotencyKey: string;
    lastError: string | null;
  }): Promise<EscalationNotificationAttempt> {
    const rec: EscalationNotificationAttempt = {
      id: `ntf_${crypto.randomUUID()}`,
      ...data,
    };
    this.notifications.push(rec);
    return rec;
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

describe("THE-103: Reminder Escalation, Grace Periods & False-Trigger Cancellation", () => {
  let store: InMemoryEscalationStore;
  const userId = "usr_escalation_owner";
  const now = new Date("2026-10-17T18:00:00Z");

  beforeEach(() => {
    store = new InMemoryEscalationStore();
  });

  it("1. falls back to SMS when Email fails, and does NOT increment remindersSentCount during a total provider outage", async () => {
    const schedule = store.seedSchedule(userId, "GRACE_PERIOD", now);

    // Case A: Email fails, SMS succeeds -> SMS fallback delivers and increments count
    const fallbackSender = {
      sendEmail: async () => ({ delivered: false, error: "Resend 503 Outage" }),
      sendSms: async () => ({ delivered: true }),
    };
    const serviceWithFallback = new EscalationService(store, fallbackSender);
    const res1 = await serviceWithFallback.dispatchStageReminderWithFallback({
      userId,
      userEmail: "owner@dusk.app",
      userPhone: "+15550199",
      idempotencyBaseKey: "rem_1",
      now,
    });
    expect(res1.anyDelivered).toBe(true);
    expect(res1.attempts).toHaveLength(2);
    expect(res1.attempts[0].status).toBe("FAILED");
    expect(res1.attempts[1].channel).toBe("SMS");
    expect(res1.attempts[1].status).toBe("DELIVERED");
    expect(res1.updatedSchedule.remindersSentCount).toBe(schedule.remindersSentCount + 1);

    // Case B: Total outage (both Email and SMS fail) -> remindersSentCount MUST NOT increment
    const countBeforeOutage = res1.updatedSchedule.remindersSentCount;
    const totalOutageSender = {
      sendEmail: async () => ({ delivered: false, error: "Resend Down" }),
      sendSms: async () => ({ delivered: false, error: "Twilio Down" }),
    };
    const serviceWithOutage = new EscalationService(store, totalOutageSender);
    const res2 = await serviceWithOutage.dispatchStageReminderWithFallback({
      userId,
      userEmail: "owner@dusk.app",
      userPhone: "+15550199",
      idempotencyBaseKey: "rem_2_outage",
      now,
    });
    expect(res2.anyDelivered).toBe(false);
    expect(res2.updatedSchedule.remindersSentCount).toBe(countBeforeOutage);
  });

  it("2. cancels a false trigger from an authenticated session and returns to HEALTHY while preserving history", async () => {
    store.seedSchedule(userId, "VERIFICATION_REQUIRED", now);
    const service = new EscalationService(store);

    const canceled = await service.cancelFalseTrigger(
      userId,
      { reason: "Was on a transatlantic flight without Wi-Fi" },
      now
    );

    expect(canceled.schedule.state).toBe("HEALTHY");
    expect(canceled.schedule.remindersSentCount).toBe(0);
    expect(canceled.schedule.graceEndsAt).toBeNull();
    expect(canceled.workflowEvent.fromState).toBe("VERIFICATION_REQUIRED");
    expect(canceled.workflowEvent.toState).toBe("HEALTHY");
    expect(store.releaseEvents[0].eventType).toBe("FALSE_TRIGGER_CANCELED_BY_OWNER");
  });

  it("3. allows a verified Trusted Verifier to signal the user is alive without gaining vault access, and blocks Recipient-only contacts", async () => {
    const schedule = store.seedSchedule(userId, "ESCALATION_PENDING", now);
    const service = new EscalationService(store);

    // Seed a Recipient-only Beneficiary (NOT a Trusted Verifier)
    store.contacts.set("cnt_recipient_only", {
      id: "cnt_recipient_only",
      userId,
      fullName: "Recipient Only",
      email: "recipient@example.com",
      phone: null,
      isBeneficiary: true,
      isTrustedVerifier: false,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: Buffer.alloc(32, 1).toString("base64"),
      keyAlgorithm: "ECDH-P256-HKDF-AES256GCM",
      createdAt: now,
      updatedAt: now,
    });

    // Seed a verified Trusted Verifier
    store.contacts.set("cnt_trusted_verifier", {
      id: "cnt_trusted_verifier",
      userId,
      fullName: "Trusted Friend",
      email: "friend@example.com",
      phone: null,
      isBeneficiary: false,
      isTrustedVerifier: true,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: null,
      keyAlgorithm: null,
      createdAt: now,
      updatedAt: now,
    });

    // Recipient-only contact cannot submit an alive signal
    await expect(
      service.signalUserAliveByTrustedContact({
        scheduleId: schedule.id,
        contactId: "cnt_recipient_only",
        attestationNote: "I spoke with them today",
      })
    ).rejects.toThrowError(AuthorizationError);

    // Verified Trusted Verifier stops escalation and returns schedule to HEALTHY
    const aliveResult = await service.signalUserAliveByTrustedContact(
      {
        scheduleId: schedule.id,
        contactId: "cnt_trusted_verifier",
        attestationNote: "Confirmed user is in hospital recovering and alive.",
      },
      now
    );

    expect(aliveResult.schedule.state).toBe("HEALTHY");
    expect(aliveResult.schedule.remindersSentCount).toBe(0);
    expect(aliveResult.workflowEvent.actorType).toBe("TRUSTED_CONTACT");
    expect(store.releaseEvents[0].eventType).toBe("VERIFIER_ATTESTED_ALIVE");
  });

  it("4. supports pausing/snoozing the schedule for travel or illness within bounded limits (1-180 days)", async () => {
    store.seedSchedule(userId, "HEALTHY", now);
    const service = new EscalationService(store);

    // Rejects > 180 days
    await expect(
      service.pauseSchedule(userId, {
        pauseDays: 365,
        reason: "Too long pause",
      })
    ).rejects.toThrowError(ValidationError);

    // Pauses for 30 days
    const paused = await service.pauseSchedule(
      userId,
      {
        pauseDays: 30,
        reason: "Climbing Kilimanjaro off-grid for 1 month",
      },
      now
    );

    expect(paused.schedule.state).toBe("PAUSED");
    expect(paused.schedule.pausedUntil?.getTime()).toBe(
      now.getTime() + 30 * MS_PER_DAY
    );
  });
});