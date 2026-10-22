// lib/services/notification-audit-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  ValidationError,
  assertResourceOwnership,
} from "../auth/security";
import {
  assertZeroKnowledgePayload,
  redactForAuditLog,
} from "../domain/trust-boundary";
import type { NotificationChannel, NotificationStatus } from "@prisma/client";

/**
 * THE-108: Notification Delivery, SMS Fallback Routing & Append-Only Audit Timeline
 *
 * Invariants:
 * 1. Notification retries are idempotent: if an `idempotencyKey` has already succeeded
 *    (`SENT` or `DELIVERED`), duplicate calls never send duplicate emails/SMS.
 * 2. Provider outages are isolated: a failed Resend/Twilio call records `FAILED` + `lastError`
 *    and triggers SMS fallback where configured, without corrupting or advancing release state.
 * 3. Audit events are strictly append-only and sanitized through `redactForAuditLog` so secrets,
 *    tokens, passwords, and vault plaintext never appear in logs or notifications.
 */

export type NotificationTemplateKey =
  | "CHECKIN_REMINDER"
  | "MISSED_CHECKIN_ESCALATION"
  | "BENEFICIARY_INVITATION"
  | "TRUSTED_VERIFIER_CHALLENGE"
  | "RELEASE_PACKAGE_READY"
  | "SECURITY_ALERT";

export type AuditCategory =
  | "ACCOUNT"
  | "SECURITY"
  | "CHECKIN"
  | "CONTACT"
  | "RECOVERY"
  | "RELEASE";

export const SendNotificationInputSchema = z.object({
  userId: z.string().min(1),
  templateKey: z.enum([
    "CHECKIN_REMINDER",
    "MISSED_CHECKIN_ESCALATION",
    "BENEFICIARY_INVITATION",
    "TRUSTED_VERIFIER_CHALLENGE",
    "RELEASE_PACKAGE_READY",
    "SECURITY_ALERT",
  ]),
  primaryEmail: z.string().email().transform((e) => e.trim().toLowerCase()),
  fallbackPhone: z.string().trim().min(7).max(30).optional().nullable(),
  idempotencyKey: z.string().min(4).max(200),
  templateVariables: z.record(z.string(), z.unknown()).default({}),
  maxRetries: z.number().int().min(1).max(5).default(2),
});

export interface NotificationDeliveryRecord {
  id: string;
  userId: string;
  channel: NotificationChannel;
  templateKey: string;
  recipientAddress: string;
  status: NotificationStatus;
  idempotencyKey: string;
  providerMessageId: string | null;
  attemptCount: number;
  lastError: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditTimelineItem {
  id: string;
  userId: string;
  category: AuditCategory;
  eventType: string;
  severity: "INFO" | "WARN" | "CRITICAL";
  actorType: string;
  actorId: string | null;
  ipAddressHash: string | null;
  userAgent: string | null;
  redactedMeta: Record<string, unknown>;
  createdAt: Date;
}

export interface ExternalNotificationProviderPort {
  sendEmail(params: {
    to: string;
    subject: string;
    templateKey: NotificationTemplateKey;
    safeVariables: Record<string, unknown>;
  }): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
    retryable?: boolean;
  }>;
  sendSms(params: {
    to: string;
    body: string;
    templateKey: NotificationTemplateKey;
  }): Promise<{
    ok: boolean;
    providerMessageId?: string;
    error?: string;
    retryable?: boolean;
  }>;
}

export interface NotificationAndAuditPersistencePort {
  findNotificationByIdempotencyKey(
    idempotencyKey: string
  ): Promise<NotificationDeliveryRecord | null>;
  upsertNotificationAttempt(data: {
    userId: string;
    channel: NotificationChannel;
    templateKey: string;
    recipientAddress: string;
    status: NotificationStatus;
    idempotencyKey: string;
    providerMessageId: string | null;
    attemptIncrement: number;
    lastError: string | null;
    sentAt: Date | null;
    deliveredAt: Date | null;
  }): Promise<NotificationDeliveryRecord>;
  listNotificationsByUserId(
    userId: string
  ): Promise<NotificationDeliveryRecord[]>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    actorType: string;
    actorId: string | null;
    ipAddressHash: string | null;
    userAgent: string | null;
    redactedMetaJson: string;
  }): Promise<{
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
  }>;
  listAuditEventsByUserId(
    userId: string,
    limit?: number
  ): Promise<
    Array<{
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
    }>
  >;
}

const TEMPLATE_SUBJECTS: Record<NotificationTemplateKey, string> = {
  CHECKIN_REMINDER: "Dusk check-in reminder",
  MISSED_CHECKIN_ESCALATION: "URGENT: Dusk missed check-in warning",
  BENEFICIARY_INVITATION: "You've been added to a Dusk release plan",
  TRUSTED_VERIFIER_CHALLENGE:
    "Action required: Dusk trusted verifier check",
  RELEASE_PACKAGE_READY: "Dusk release package ready",
  SECURITY_ALERT: "Dusk account security alert",
};

export function classifyAuditEventCategory(eventType: string): AuditCategory {
  if (
    eventType.startsWith("RECOVERY_") ||
    eventType.includes("RECOVERY_KIT")
  ) {
    return "RECOVERY";
  }
  if (
    eventType.startsWith("CHECKIN_") ||
    eventType.startsWith("PROOF_OF_LIFE") ||
    eventType.startsWith("WORKFLOW_STATE_") ||
    eventType.includes("FALSE_TRIGGER")
  ) {
    return "CHECKIN";
  }
  if (
    eventType.startsWith("CONTACT_") ||
    eventType.startsWith("BENEFICIARY_ITEM_")
  ) {
    return "CONTACT";
  }
  if (
    eventType.includes("RELEASE") ||
    eventType.includes("PACKAGE_") ||
    eventType.startsWith("VERIFIER_")
  ) {
    return "RELEASE";
  }
  if (
    eventType.startsWith("SESSION_") ||
    eventType.startsWith("SECURITY_") ||
    eventType.includes("SUSPICIOUS") ||
    eventType.includes("FAILED")
  ) {
    return "SECURITY";
  }
  return "ACCOUNT";
}

export class NotificationAndAuditService {
  constructor(
    private readonly store: NotificationAndAuditPersistencePort,
    private readonly provider: ExternalNotificationProviderPort
  ) {}

  /**
   * Dispatches a notification with bounded retries, idempotency protection,
   * zero-knowledge variable redaction, and automatic SMS fallback if primary Email fails.
   */
  async sendNotificationWithFallback(
    rawInput: unknown,
    now = new Date()
  ): Promise<{
    delivered: boolean;
    primaryRecord: NotificationDeliveryRecord;
    fallbackRecord: NotificationDeliveryRecord | null;
    wasDuplicateNoOp: boolean;
  }> {
    // Reject if caller accidentally passed raw vault plaintext or keys in template variables
    assertZeroKnowledgePayload(rawInput);

    const parsed = SendNotificationInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid notification parameters."
      );
    }
    const input = parsed.data;
    const safeVariables = redactForAuditLog(input.templateVariables);

    // 1. Check idempotency: if already DELIVERED or SENT, return immediately without resending
    const existingPrimary =
      await this.store.findNotificationByIdempotencyKey(input.idempotencyKey);
    if (
      existingPrimary &&
      (existingPrimary.status === "DELIVERED" ||
        existingPrimary.status === "SENT")
    ) {
      return {
        delivered: true,
        primaryRecord: existingPrimary,
        fallbackRecord: null,
        wasDuplicateNoOp: true,
      };
    }

    // 2. Attempt primary Email delivery (up to maxRetries on retryable errors)
    const subject = TEMPLATE_SUBJECTS[input.templateKey];
    let emailSuccess = false;
    let lastEmailError: string | null = null;
    let providerMessageId: string | null = null;
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= input.maxRetries; attempt++) {
      attemptsMade++;
      const res = await this.provider.sendEmail({
        to: input.primaryEmail,
        subject,
        templateKey: input.templateKey,
        safeVariables,
      });

      if (res.ok) {
        emailSuccess = true;
        providerMessageId = res.providerMessageId ?? `msg_email_${now.getTime()}`;
        lastEmailError = null;
        break;
      }

      lastEmailError = res.error ?? "Email provider error";
      if (res.retryable === false) {
        break;
      }
    }

    const primaryRecord = await this.store.upsertNotificationAttempt({
      userId: input.userId,
      channel: "EMAIL",
      templateKey: input.templateKey,
      recipientAddress: input.primaryEmail,
      status: emailSuccess ? "DELIVERED" : "FAILED",
      idempotencyKey: input.idempotencyKey,
      providerMessageId,
      attemptIncrement: attemptsMade,
      lastError: lastEmailError,
      sentAt: emailSuccess ? now : null,
      deliveredAt: emailSuccess ? now : null,
    });

    if (emailSuccess) {
      return {
        delivered: true,
        primaryRecord,
        fallbackRecord: null,
        wasDuplicateNoOp: false,
      };
    }

    // 3. Automatic SMS Fallback if Email failed and `fallbackPhone` is configured
    let fallbackRecord: NotificationDeliveryRecord | null = null;
    let smsSuccess = false;

    if (input.fallbackPhone) {
      const smsIdempotencyKey = `${input.idempotencyKey}:SMS_FALLBACK`;
      const existingFallback =
        await this.store.findNotificationByIdempotencyKey(smsIdempotencyKey);

      if (
        existingFallback &&
        (existingFallback.status === "DELIVERED" ||
          existingFallback.status === "SENT")
      ) {
        return {
          delivered: true,
          primaryRecord,
          fallbackRecord: existingFallback,
          wasDuplicateNoOp: true,
        };
      }

      const smsRes = await this.provider.sendSms({
        to: input.fallbackPhone,
        body: `[Dusk] ${subject}. Please sign in to your Dusk dashboard.`,
        templateKey: input.templateKey,
      });

      smsSuccess = smsRes.ok;
      fallbackRecord = await this.store.upsertNotificationAttempt({
        userId: input.userId,
        channel: "SMS",
        templateKey: input.templateKey,
        recipientAddress: input.fallbackPhone,
        status: smsSuccess ? "DELIVERED" : "FAILED",
        idempotencyKey: smsIdempotencyKey,
        providerMessageId: smsRes.providerMessageId ?? null,
        attemptIncrement: 1,
        lastError: smsRes.error ?? null,
        sentAt: smsSuccess ? now : null,
        deliveredAt: smsSuccess ? now : null,
      });
    }

    // Record operational audit event if both primary and fallback failed
    if (!smsSuccess) {
      await this.appendAuditRecord({
        userId: input.userId,
        eventType: "SECURITY_NOTIFICATION_DELIVERY_FAILED",
        severity: "WARN",
        actorType: "SYSTEM",
        actorId: null,
        metadata: {
          templateKey: input.templateKey,
          idempotencyKey: input.idempotencyKey,
          primaryError: lastEmailError,
          hadSmsFallback: Boolean(input.fallbackPhone),
        },
      });
    }

    return {
      delivered: smsSuccess,
      primaryRecord,
      fallbackRecord,
      wasDuplicateNoOp: false,
    };
  }

  /**
   * Appends a strictly redacted event to the append-only Audit Timeline.
   */
  async appendAuditRecord(params: {
    userId: string;
    eventType: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    actorType: "USER" | "BENEFICIARY" | "TRUSTED_CONTACT" | "SYSTEM";
    actorId: string | null;
    ipAddressHash?: string | null;
    userAgent?: string | null;
    metadata: Record<string, unknown>;
  }): Promise<AuditTimelineItem> {
    const cleanMeta = redactForAuditLog(params.metadata);
    const created = await this.store.appendAuditEvent({
      userId: params.userId,
      eventType: params.eventType,
      severity: params.severity,
      actorType: params.actorType,
      actorId: params.actorId,
      ipAddressHash: params.ipAddressHash ?? null,
      userAgent: params.userAgent ?? null,
      redactedMetaJson: JSON.stringify(cleanMeta),
    });

    return {
      id: created.id,
      userId: created.userId,
      category: classifyAuditEventCategory(created.eventType),
      eventType: created.eventType,
      severity: created.severity as "INFO" | "WARN" | "CRITICAL",
      actorType: created.actorType,
      actorId: created.actorId,
      ipAddressHash: created.ipAddressHash,
      userAgent: created.userAgent,
      redactedMeta: cleanMeta,
      createdAt: created.createdAt,
    };
  }

  /**
   * Queries the user's append-only Audit Timeline with optional category or severity filtering.
   */
  async getAuditTimelineForUser(
    authenticatedUserId: string | null | undefined,
    filter?: {
      category?: AuditCategory | "ALL";
      severity?: "INFO" | "WARN" | "CRITICAL" | "ALL";
      limit?: number;
    }
  ): Promise<AuditTimelineItem[]> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const rawEvents = await this.store.listAuditEventsByUserId(
      authenticatedUserId,
      filter?.limit ?? 100
    );

    const mapped: AuditTimelineItem[] = rawEvents.map((ev) => {
      assertResourceOwnership(ev, authenticatedUserId, "AuditEvent");
      let parsedMeta: Record<string, unknown> = {};
      try {
        parsedMeta = redactForAuditLog(JSON.parse(ev.redactedMeta));
      } catch {
        parsedMeta = {};
      }
      return {
        id: ev.id,
        userId: ev.userId,
        category: classifyAuditEventCategory(ev.eventType),
        eventType: ev.eventType,
        severity: (ev.severity as "INFO" | "WARN" | "CRITICAL") || "INFO",
        actorType: ev.actorType,
        actorId: ev.actorId,
        ipAddressHash: ev.ipAddressHash,
        userAgent: ev.userAgent,
        redactedMeta: parsedMeta,
        createdAt: ev.createdAt,
      };
    });

    return mapped.filter((item) => {
      if (
        filter?.category &&
        filter.category !== "ALL" &&
        item.category !== filter.category
      ) {
        return false;
      }
      if (
        filter?.severity &&
        filter.severity !== "ALL" &&
        item.severity !== filter.severity
      ) {
        return false;
      }
      return true;
    });
  }
}