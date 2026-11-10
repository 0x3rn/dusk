// lib/services/prisma-notification-store.ts
import type { PrismaClient } from "@prisma/client";
import type {
  NotificationAndAuditPersistencePort,
  NotificationDeliveryRecord,
} from "./notification-audit-service";

export class PrismaNotificationStore implements NotificationAndAuditPersistencePort {
  constructor(private readonly db: PrismaClient) {}

  findNotificationByIdempotencyKey(
    idempotencyKey: string
  ): Promise<NotificationDeliveryRecord | null> {
    return this.db.notificationDelivery.findUnique({ where: { idempotencyKey } });
  }

  upsertNotificationAttempt(
    data: Parameters<NotificationAndAuditPersistencePort["upsertNotificationAttempt"]>[0]
  ): Promise<NotificationDeliveryRecord> {
    const { attemptIncrement, ...fields } = data;
    return this.db.notificationDelivery.upsert({
      where: { idempotencyKey: data.idempotencyKey },
      create: { ...fields, attemptCount: attemptIncrement },
      update: {
        status: fields.status,
        providerMessageId: fields.providerMessageId,
        lastError: fields.lastError,
        sentAt: fields.sentAt,
        deliveredAt: fields.deliveredAt,
        attemptCount: { increment: attemptIncrement },
      },
    });
  }

  listNotificationsByUserId(userId: string): Promise<NotificationDeliveryRecord[]> {
    return this.db.notificationDelivery.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  appendAuditEvent(
    data: Parameters<NotificationAndAuditPersistencePort["appendAuditEvent"]>[0]
  ) {
    const { redactedMetaJson, ...rest } = data;
    return this.db.auditEvent.create({ data: { ...rest, redactedMeta: redactedMetaJson } });
  }

  listAuditEventsByUserId(userId: string, limit = 100) {
    return this.db.auditEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }
}
