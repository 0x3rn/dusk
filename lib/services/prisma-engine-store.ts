// lib/services/prisma-engine-store.ts
// PostgreSQL (Prisma) persistence for the dead-man's-switch engine: check-in schedule, escalation,
// release verification, release delivery and selective release. One class, because these
// services share the same CheckInSchedule / ReleaseEvent / Contact tables.
//
// Every write that must be exactly-once is enforced by the database:
//  - schedule changes are optimistic (WHERE version = expected) and write their WorkflowEvent in
//    the same transaction; WorkflowEvent.idempotencyKey is UNIQUE
//  - single-use tokens are consumed with a conditional UPDATE (WHERE tokenUsedAt IS NULL)
import { Prisma, type PrismaClient } from "@prisma/client";
import { AuthorizationError } from "../auth/security";
import {
  ConcurrencyConflictError,
  type CheckInSchedulePersistencePort,
  type DetailedScheduleRecord,
  type SingleUseCheckInTokenRecord,
  type WorkflowEventRecord,
} from "./checkin-schedule-service";
import type { ContactRecord } from "./contact-service";
import type {
  EscalationNotificationAttempt,
  EscalationPersistencePort,
} from "./escalation-service";
import type { ReleaseDeliveryPersistencePort } from "./release-delivery-service";
import type {
  ReleaseEventRecord,
  ReleaseVerificationPersistencePort,
} from "./release-verification-service";
import type {
  ReleaseAssignmentRecord,
  SelectiveReleasePersistencePort,
} from "./selective-release-service";
import type { EncryptedItemRecord } from "./foundation-service";
import {
  SelectiveReleaseService,
  type ScopedBeneficiaryReleasePackage,
} from "./selective-release-service";

export const CHECKIN_TOKEN_EVENT_TYPE = "CHECKIN_LINK_ISSUED";

type ScheduleUpdate = Partial<
  Omit<DetailedScheduleRecord, "id" | "userId" | "version" | "createdAt" | "updatedAt">
>;

type ScheduleEventInput = {
  userId: string;
  fromState: DetailedScheduleRecord["state"];
  toState: DetailedScheduleRecord["state"];
  reason: string;
  idempotencyKey: string;
  actorType: "USER" | "SYSTEM_SCHEDULER" | "TRUSTED_CONTACT";
  actorId: string | null;
};

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export class PrismaEngineStore
  implements
    CheckInSchedulePersistencePort,
    EscalationPersistencePort,
    ReleaseVerificationPersistencePort,
    ReleaseDeliveryPersistencePort,
    SelectiveReleasePersistencePort
{
  constructor(private readonly db: PrismaClient) {}

  // ---- schedules -----------------------------------------------------------------------

  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null> {
    return this.db.checkInSchedule.findUnique({ where: { userId } });
  }

  findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null> {
    return this.db.checkInSchedule.findUnique({ where: { id: scheduleId } });
  }

  findWorkflowEventByIdempotencyKey(key: string): Promise<WorkflowEventRecord | null> {
    return this.db.workflowEvent.findUnique({ where: { idempotencyKey: key } });
  }

  /** Atomically applies a schedule change and records its workflow event. */
  private async applyScheduleChange(params: {
    scheduleId: string;
    expectedVersion: number;
    data: ScheduleUpdate;
    event: ScheduleEventInput;
  }): Promise<{ schedule: DetailedScheduleRecord; workflowEvent: WorkflowEventRecord }> {
    const data = Object.fromEntries(
      Object.entries(params.data).filter(([, v]) => v !== undefined)
    ) as ScheduleUpdate;

    try {
      return await this.db.$transaction(async (tx) => {
        const updated = await tx.checkInSchedule.updateMany({
          where: { id: params.scheduleId, version: params.expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) {
          throw new ConcurrencyConflictError();
        }
        const workflowEvent = await tx.workflowEvent.create({
          data: {
            scheduleId: params.scheduleId,
            userId: params.event.userId,
            fromState: params.event.fromState,
            toState: params.event.toState,
            reason: params.event.reason,
            idempotencyKey: params.event.idempotencyKey,
            actorType: params.event.actorType,
            actorId: params.event.actorId,
          },
        });
        const schedule = await tx.checkInSchedule.findUniqueOrThrow({
          where: { id: params.scheduleId },
        });
        return { schedule, workflowEvent };
      });
    } catch (err) {
      // A duplicate idempotency key means another run already applied this exact change.
      if (isUniqueViolation(err)) throw new ConcurrencyConflictError();
      throw err;
    }
  }

  updateScheduleWithVersionCheck(params: {
    scheduleId: string;
    expectedVersion: number;
    data: ScheduleUpdate;
    event: ScheduleEventInput;
  }) {
    return this.applyScheduleChange(params);
  }

  updateScheduleState(params: {
    scheduleId: string;
    expectedVersion: number;
    data: Partial<DetailedScheduleRecord>;
    event: ScheduleEventInput;
  }) {
    return this.applyScheduleChange(params);
  }

  // ---- single-use check-in links -------------------------------------------------------

  async createSingleUseCheckInToken(data: {
    scheduleId: string;
    userId: string;
    actionTokenHash: string;
    tokenExpiresAt: Date;
  }): Promise<SingleUseCheckInTokenRecord> {
    const row = await this.db.releaseEvent.create({
      data: {
        scheduleId: data.scheduleId,
        userId: data.userId,
        eventType: CHECKIN_TOKEN_EVENT_TYPE,
        actionTokenHash: data.actionTokenHash,
        tokenExpiresAt: data.tokenExpiresAt,
      },
    });
    return this.toCheckInToken(row);
  }

  async findSingleUseCheckInTokenByHash(
    tokenHash: string
  ): Promise<SingleUseCheckInTokenRecord | null> {
    const row = await this.db.releaseEvent.findUnique({ where: { actionTokenHash: tokenHash } });
    if (!row || row.eventType !== CHECKIN_TOKEN_EVENT_TYPE) return null;
    return this.toCheckInToken(row);
  }

  async markSingleUseCheckInTokenUsed(
    tokenId: string,
    usedAt: Date
  ): Promise<SingleUseCheckInTokenRecord> {
    // Conditional update: of two simultaneous clicks, exactly one wins.
    const result = await this.db.releaseEvent.updateMany({
      where: { id: tokenId, tokenUsedAt: null, eventType: CHECKIN_TOKEN_EVENT_TYPE },
      data: { tokenUsedAt: usedAt },
    });
    if (result.count !== 1) {
      throw new AuthorizationError("This single-use check-in link has already been used.");
    }
    const row = await this.db.releaseEvent.findUniqueOrThrow({ where: { id: tokenId } });
    return this.toCheckInToken(row);
  }

  private toCheckInToken(row: {
    id: string;
    scheduleId: string;
    userId: string;
    actionTokenHash: string | null;
    tokenExpiresAt: Date | null;
    tokenUsedAt: Date | null;
  }): SingleUseCheckInTokenRecord {
    if (!row.actionTokenHash || !row.tokenExpiresAt) {
      throw new Error("Check-in token row is missing its hash or expiry.");
    }
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      userId: row.userId,
      actionTokenHash: row.actionTokenHash,
      tokenExpiresAt: row.tokenExpiresAt,
      tokenUsedAt: row.tokenUsedAt,
    };
  }

  // ---- contacts ------------------------------------------------------------------------

  findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.db.contact.findUnique({ where: { id: contactId } });
  }

  // ---- release events (verification, holds, grants) ------------------------------------

  listReleaseEventsByScheduleId(scheduleId: string): Promise<ReleaseEventRecord[]> {
    return this.db.releaseEvent.findMany({
      where: { scheduleId },
      orderBy: { createdAt: "asc" },
    });
  }

  findReleaseEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null> {
    return this.db.releaseEvent.findUnique({ where: { actionTokenHash: tokenHash } });
  }

  findGrantEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null> {
    return this.db.releaseEvent.findUnique({ where: { actionTokenHash: tokenHash } });
  }

  findGrantEventById(eventId: string): Promise<ReleaseEventRecord | null> {
    return this.db.releaseEvent.findUnique({ where: { id: eventId } });
  }

  listReleaseEventsForContact(
    scheduleId: string,
    contactId: string
  ): Promise<ReleaseEventRecord[]> {
    return this.db.releaseEvent.findMany({
      where: { scheduleId, contactId },
      orderBy: { createdAt: "asc" },
    });
  }

  createReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    actionTokenHash?: string | null;
    tokenExpiresAt?: Date | null;
    metadataJson?: string | null;
  }): Promise<ReleaseEventRecord> {
    return this.db.releaseEvent.create({
      data: {
        scheduleId: data.scheduleId,
        userId: data.userId,
        contactId: data.contactId,
        eventType: data.eventType,
        actionTokenHash: data.actionTokenHash ?? null,
        tokenExpiresAt: data.tokenExpiresAt ?? null,
        metadataJson: data.metadataJson ?? null,
      },
    });
  }

  async recordReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    metadataJson: string;
  }): Promise<void> {
    await this.createReleaseEvent(data);
  }

  async markReleaseEventTokenUsed(eventId: string, usedAt: Date): Promise<ReleaseEventRecord> {
    return this.consumeToken(eventId, usedAt);
  }

  async markGrantTokenUsed(eventId: string, usedAt: Date): Promise<ReleaseEventRecord> {
    return this.consumeToken(eventId, usedAt);
  }

  private async consumeToken(eventId: string, usedAt: Date): Promise<ReleaseEventRecord> {
    const result = await this.db.releaseEvent.updateMany({
      where: { id: eventId, tokenUsedAt: null },
      data: { tokenUsedAt: usedAt },
    });
    if (result.count !== 1) {
      throw new AuthorizationError("This single-use link has already been used.");
    }
    return this.db.releaseEvent.findUniqueOrThrow({ where: { id: eventId } });
  }

  // ---- notifications recorded by the escalation service --------------------------------

  async findNotificationAttemptByKey(
    idempotencyKey: string
  ): Promise<EscalationNotificationAttempt | null> {
    return this.db.notificationDelivery.findUnique({ where: { idempotencyKey } });
  }

  recordNotificationAttempt(data: {
    userId: string;
    channel: EscalationNotificationAttempt["channel"];
    templateKey: string;
    recipientAddress: string;
    status: EscalationNotificationAttempt["status"];
    idempotencyKey: string;
    lastError: string | null;
  }): Promise<EscalationNotificationAttempt> {
    return this.db.notificationDelivery.upsert({
      where: { idempotencyKey: data.idempotencyKey },
      create: { ...data, attemptCount: 1, sentAt: new Date() },
      update: {
        status: data.status,
        lastError: data.lastError,
        attemptCount: { increment: 1 },
      },
    });
  }

  assembleScopedPackage(
    userId: string,
    contactId: string
  ): Promise<ScopedBeneficiaryReleasePackage> {
    return new SelectiveReleaseService(this).assembleScopedPackageForBeneficiary(userId, contactId);
  }

  // ---- audit ---------------------------------------------------------------------------

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        userId: data.userId,
        eventType: data.eventType,
        severity: data.severity,
        actorType: "SYSTEM",
        redactedMeta: data.redactedMeta,
      },
    });
  }

  // ---- selective release ---------------------------------------------------------------

  findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null> {
    return this.db.encryptedItem.findUnique({ where: { id: itemId } });
  }

  listEncryptedItemsByFolderId(userId: string, folderId: string): Promise<EncryptedItemRecord[]> {
    return this.db.encryptedItem.findMany({ where: { userId, folderId } });
  }

  async upsertReleaseAssignment(data: {
    userId: string;
    contactId: string;
    itemId: string;
    folderId: string | null;
    beneficiaryWrappedKeyBase64: string;
    beneficiaryWrappedKeyIv: string;
    ephemeralPublicKeyBase64: string;
    keyVersion: number;
  }): Promise<ReleaseAssignmentRecord> {
    const row = await this.db.releaseAssignment.upsert({
      where: { contactId_itemId: { contactId: data.contactId, itemId: data.itemId } },
      create: data,
      update: {
        folderId: data.folderId,
        beneficiaryWrappedKeyBase64: data.beneficiaryWrappedKeyBase64,
        beneficiaryWrappedKeyIv: data.beneficiaryWrappedKeyIv,
        ephemeralPublicKeyBase64: data.ephemeralPublicKeyBase64,
        keyVersion: data.keyVersion,
      },
    });
    return this.toAssignment(row);
  }

  async deleteReleaseAssignment(contactId: string, itemId: string): Promise<boolean> {
    const result = await this.db.releaseAssignment.deleteMany({ where: { contactId, itemId } });
    return result.count > 0;
  }

  async listAssignmentsByContactId(contactId: string): Promise<ReleaseAssignmentRecord[]> {
    const rows = await this.db.releaseAssignment.findMany({ where: { contactId } });
    return rows.map((r) => this.toAssignment(r));
  }

  private toAssignment(row: {
    id: string;
    userId: string;
    contactId: string;
    itemId: string | null;
    folderId: string | null;
    beneficiaryWrappedKeyBase64: string;
    beneficiaryWrappedKeyIv: string;
    ephemeralPublicKeyBase64: string;
    keyVersion: number;
    createdAt: Date;
    updatedAt: Date;
  }): ReleaseAssignmentRecord {
    if (!row.itemId) {
      throw new Error("ReleaseAssignment row has no itemId.");
    }
    return { ...row, itemId: row.itemId };
  }
}
