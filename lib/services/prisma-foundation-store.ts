import { Prisma, type PrismaClient } from "@prisma/client";
import {
  UniqueConstraintError,
  type AuditEventRecord,
  type CheckInScheduleRecord,
  type EncryptedItemRecord,
  type FoundationPersistencePort,
  type UserRecord,
  type VaultRecord,
} from "./foundation-service";

/** Only the columns callers may see: never leak mfaSecretEncrypted, stripeCustomerId, etc. */
const USER_SELECT = {
  id: true,
  authUserId: true,
  email: true,
  fullName: true,
  hasLifetimeAccess: true,
  createdAt: true,
} as const;

export class PrismaFoundationStore implements FoundationPersistencePort {
  constructor(private readonly db: PrismaClient) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { email }, select: USER_SELECT });
  }

  async findUserByAuthUserId(authUserId: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { authUserId }, select: USER_SELECT });
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.db.user.findUnique({ where: { id }, select: USER_SELECT });
  }

  async createUser(data: {
    authUserId: string;
    email: string;
    fullName: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<UserRecord> {
    try {
      return await this.db.user.create({ data, select: USER_SELECT });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new UniqueConstraintError();
      }
      throw err;
    }
  }

  async linkAuthIdentity(
    userId: string,
    authUserId: string,
    emailVerifiedAt: Date
  ): Promise<UserRecord> {
    try {
      // The authUserId IS NULL guard makes linking a one-way, race-safe operation.
      const result = await this.db.user.updateMany({
        where: { id: userId, authUserId: null },
        data: { authUserId, emailVerifiedAt },
      });
      if (result.count !== 1) {
        throw new UniqueConstraintError("User is already linked to a sign-in identity.");
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new UniqueConstraintError();
      }
      throw err;
    }
    return this.db.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
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