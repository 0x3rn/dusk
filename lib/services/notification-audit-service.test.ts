// lib/services/notification-audit-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  NotificationAndAuditService,
  type ExternalNotificationProviderPort,
  type NotificationAndAuditPersistencePort,
  type NotificationDeliveryRecord,
} from "./notification-audit-service";
import { TrustBoundaryViolationError } from "../domain/trust-boundary";

class InMemoryNotificationAuditStore
  implements NotificationAndAuditPersistencePort
{
  public notifications = new Map<string, NotificationDeliveryRecord>();
  public audits: Array<{
    id: string;
    userId: string;
    eventType: string;
    severity: string;
    actorType: string;
    actorId: string | null;
    ipAddressHash: string | null;
    userAgent: string | null;
    redactedMeta: string;
    createdAt: Date;
  }> = [];

  async findNotificationByIdempotencyKey(
    idempotencyKey: string
  ): Promise<NotificationDeliveryRecord | null> {
    return this.notifications.get(idempotencyKey) ?? null;
  }

  async upsertNotificationAttempt(data: {
    userId: string;
    channel: NotificationDeliveryRecord["channel"];
    templateKey: string;
    recipientAddress: string;
    status: NotificationDeliveryRecord["status"];
    idempotencyKey: string;
    providerMessageId: string | null;
    attemptIncrement: number;
    lastError: string | null;
    sentAt: Date | null;
    deliveredAt: Date | null;
  }): Promise<NotificationDeliveryRecord> {
    const existing = this.notifications.get(data.idempotencyKey);
    const now = new Date();
    const rec: NotificationDeliveryRecord = {
      id: existing?.id ?? `ntf_${crypto.randomUUID()}`,
      userId: data.userId,
      channel: data.channel,
      templateKey: data.templateKey,
      recipientAddress: data.recipientAddress,
      status: data.status,
      idempotencyKey: data.idempotencyKey,
      providerMessageId: data.providerMessageId,
      attemptCount: (existing?.attemptCount ?? 0) + data.attemptIncrement,
      lastError: data.lastError,
      sentAt: data.sentAt,
      deliveredAt: data.deliveredAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.notifications.set(data.idempotencyKey, rec);
    return rec;
  }

  async listNotificationsByUserId(
    userId: string
  ): Promise<NotificationDeliveryRecord[]> {
    return Array.from(this.notifications.values()).filter(
      (n) => n.userId === userId
    );
  }

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    actorType: string;
    actorId: string | null;
    ipAddressHash: string | null;
    userAgent: string | null;
    redactedMetaJson: string;
  }) {
    const rec = {
      id: `aud_${crypto.randomUUID()}`,
      userId: data.userId,
      eventType: data.eventType,
      severity: data.severity,
      actorType: data.actorType,
      actorId: data.actorId,
      ipAddressHash: data.ipAddressHash,
      userAgent: data.userAgent,
      redactedMeta: data.redactedMetaJson,
      createdAt: new Date(),
    };
    this.audits.unshift(rec);
    return rec;
  }

  async listAuditEventsByUserId(userId: string, limit = 100) {
    return this.audits.filter((a) => a.userId === userId).slice(0, limit);
  }
}

describe("THE-108: Notification Delivery, Fallback Routing & Audit Timeline", () => {
  let store: InMemoryNotificationAuditStore;
  const userId = "usr_notify_owner";

  beforeEach(() => {
    store = new InMemoryNotificationAuditStore();
  });

  it("1. enforces idempotent delivery so duplicate jobs never send duplicate notifications", async () => {
    let emailSendCalls = 0;
    const provider: ExternalNotificationProviderPort = {
      sendEmail: async () => {
        emailSendCalls++;
        return { ok: true, providerMessageId: "resend_msg_001" };
      },
      sendSms: async () => ({ ok: true, providerMessageId: "twilio_msg_001" }),
    };

    const service = new NotificationAndAuditService(store, provider);

    const first = await service.sendNotificationWithFallback({
      userId,
      templateKey: "CHECKIN_REMINDER",
      primaryEmail: "owner@dusk.app",
      idempotencyKey: "remind_cycle_1",
      templateVariables: { daysRemaining: 7 },
    });
    expect(first.delivered).toBe(true);
    expect(first.wasDuplicateNoOp).toBe(false);
    expect(emailSendCalls).toBe(1);

    // Second run with the exact same idempotencyKey is a no-op
    const duplicate = await service.sendNotificationWithFallback({
      userId,
      templateKey: "CHECKIN_REMINDER",
      primaryEmail: "owner@dusk.app",
      idempotencyKey: "remind_cycle_1",
      templateVariables: { daysRemaining: 7 },
    });
    expect(duplicate.delivered).toBe(true);
    expect(duplicate.wasDuplicateNoOp).toBe(true);
    expect(emailSendCalls).toBe(1);
  });

  it("2. retries transient email failures and routes to SMS fallback when email is down", async () => {
    let emailAttempts = 0;
    let smsAttempts = 0;
    const failingEmailProvider: ExternalNotificationProviderPort = {
      sendEmail: async () => {
        emailAttempts++;
        return {
          ok: false,
          error: "Resend 502 Bad Gateway",
          retryable: true,
        };
      },
      sendSms: async () => {
        smsAttempts++;
        return { ok: true, providerMessageId: "twilio_sid_999" };
      },
    };

    const service = new NotificationAndAuditService(store, failingEmailProvider);

    const res = await service.sendNotificationWithFallback({
      userId,
      templateKey: "MISSED_CHECKIN_ESCALATION",
      primaryEmail: "owner@dusk.app",
      fallbackPhone: "+15550199",
      idempotencyKey: "esc_cycle_1",
      maxRetries: 2,
    });

    expect(emailAttempts).toBe(2);
    expect(smsAttempts).toBe(1);
    expect(res.delivered).toBe(true);
    expect(res.primaryRecord.status).toBe("FAILED");
    expect(res.primaryRecord.attemptCount).toBe(2);
    expect(res.fallbackRecord?.channel).toBe("SMS");
    expect(res.fallbackRecord?.status).toBe("DELIVERED");
  });

  it("3. blocks plaintext vault secrets from notification payloads and redacts sensitive fields in the append-only audit timeline", async () => {
    const provider: ExternalNotificationProviderPort = {
      sendEmail: async () => ({ ok: true }),
      sendSms: async () => ({ ok: true }),
    };
    const service = new NotificationAndAuditService(store, provider);

    // Blocks accidental secret leakage into external notification variables
    await expect(
      service.sendNotificationWithFallback({
        userId,
        templateKey: "RELEASE_PACKAGE_READY",
        primaryEmail: "ben@example.com",
        idempotencyKey: "leak_attempt_1",
        templateVariables: {
          seedPhrase: "abandon ability able...",
        },
      })
    ).rejects.toThrowError(TrustBoundaryViolationError);

    // Append events across categories and verify redaction + filtering
    await service.appendAuditRecord({
      userId,
      eventType: "RECOVERY_KIT_ROTATED",
      severity: "CRITICAL",
      actorType: "USER",
      actorId: userId,
      metadata: {
        fingerprintHex: "abcdef0123456789",
        recoveryPassphrase: "secret-passphrase-never-logged",
      },
    });

    await service.appendAuditRecord({
      userId,
      eventType: "PROOF_OF_LIFE_CHECKIN_CONFIRMED",
      severity: "INFO",
      actorType: "USER",
      actorId: userId,
      metadata: {
        sessionToken: "secret_tok_999",
        nextDueInDays: 90,
      },
    });

    const recoveryEvents = await service.getAuditTimelineForUser(userId, {
      category: "RECOVERY",
    });
    expect(recoveryEvents).toHaveLength(1);
    expect(recoveryEvents[0].redactedMeta.fingerprintHex).toBe(
      "abcdef0123456789"
    );
    expect(recoveryEvents[0].redactedMeta.recoveryPassphrase).toBe(
      "[REDACTED]"
    );

    const checkinEvents = await service.getAuditTimelineForUser(userId, {
      category: "CHECKIN",
    });
    expect(checkinEvents).toHaveLength(1);
    expect(checkinEvents[0].redactedMeta.sessionToken).toBe("[REDACTED]");
    expect(checkinEvents[0].redactedMeta.nextDueInDays).toBe(90);
  });
});