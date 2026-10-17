// lib/services/prisma-foundation-store.ts
import type { PrismaClient } from "@prisma/client";
import type {
  AuditEventRecord,
  CheckInScheduleRecord,
  EncryptedItemRecord,
  FoundationPersistencePort,
  SessionRecord,
  UserRecord,
  VaultRecord,
} from "./foundation-service";

export class PrismaFoundationStore implements FoundationPersistencePort {
  constructor(private readonly db: PrismaClient) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { email } });
  }

  async findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { firebaseUid } });
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { id } });
  }

  async createUser(data: {
    email: string;
    fullName: string | null;
    passwordHash: string | null;
    firebaseUid: string | null;
    authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
  }): Promise<UserRecord> {
    return this.db.user.create({ data });
  }

  async updateUserAuthLink(
    userId: string,
    data: {
      firebaseUid?: string;
      passwordHash?: string;
      authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
    }
  ): Promise<UserRecord> {
    return this.db.user.update({
      where: { id: userId },
      data,
    });
  }

  async createSession(data: {
    userId: string;
    tokenHash: string;
    deviceName: string | null;
    userAgent: string | null;
    ipAddressHash: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    return this.db.session.create({ data });
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<SessionRecord> {
    return this.db.session.update({
      where: { id: sessionId },
      data: { revokedAt },
    });
  }

  async ensureDefaultSchedule(
    userId: string,
    now: Date
  ): Promise<CheckInScheduleRecord> {
    const nextDueAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    return this.db.checkInSchedule.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        state: "HEALTHY",
        intervalDays: 90,
        gracePeriodDays: 14,
        lastCheckInAt: now,
        nextDueAt,
      },
    });
  }

  async findVaultByUserId(userId: string): Promise<VaultRecord | null> {
    return this.db.vault.findUnique({ where: { userId } });
  }

  async findVaultById(vaultId: string): Promise<VaultRecord | null> {
    return this.db.vault.findUnique({ where: { id: vaultId } });
  }

  async createVault(data: {
    userId: string;
    wrappedMasterKeyCiphertext: string;
    wrappedMasterKeyIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
  }): Promise<VaultRecord> {
    return this.db.vault.create({ data });
  }

  async createEncryptedItem(data: {
    vaultId: string;
    userId: string;
    folderId: string | null;
    category: EncryptedItemRecord["category"];
    schemaVersion: number;
    keyVersion: number;
    ciphertextBase64: string;
    ivBase64: string;
    wrappedItemKeyBase64: string;
    wrappedItemKeyIvBase64: string;
    aadResourceId: string;
  }): Promise<EncryptedItemRecord> {
    return this.db.encryptedItem.create({ data });
  }

  async findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null> {
    return this.db.encryptedItem.findUnique({ where: { id: itemId } });
  }

  async listEncryptedItemsByVaultId(vaultId: string): Promise<EncryptedItemRecord[]> {
    return this.db.encryptedItem.findMany({
      where: { vaultId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    });
  }

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    actorType: string;
    actorId: string | null;
    ipAddressHash: string | null;
    userAgent: string | null;
    redactedMeta: string;
  }): Promise<AuditEventRecord> {
    return this.db.auditEvent.create({ data });
  }

  async listAuditEventsByUserId(userId: string): Promise<AuditEventRecord[]> {
    return this.db.auditEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }
}