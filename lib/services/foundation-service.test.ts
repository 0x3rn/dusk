// lib/services/foundation-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthenticationError,
  AuthorizationError,
  FoundationService,
  TrustBoundaryViolationError,
  ValidationError,
  type AuditEventRecord,
  type CheckInScheduleRecord,
  type EncryptedItemRecord,
  type FoundationPersistencePort,
  type SessionRecord,
  type UserRecord,
  type VaultRecord,
} from "./foundation-service";

class InMemoryFoundationStore implements FoundationPersistencePort {
  public users = new Map<string, UserRecord>();
  public sessions = new Map<string, SessionRecord>();
  public schedules = new Map<string, CheckInScheduleRecord>();
  public vaults = new Map<string, VaultRecord>();
  public items = new Map<string, EncryptedItemRecord>();
  public audits: AuditEventRecord[] = [];

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.firebaseUid === firebaseUid) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(data: {
    email: string;
    fullName: string | null;
    passwordHash: string | null;
    firebaseUid: string | null;
    authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
  }): Promise<UserRecord> {
    const record: UserRecord = {
      id: `usr_${crypto.randomUUID()}`,
      email: data.email,
      fullName: data.fullName,
      passwordHash: data.passwordHash,
      firebaseUid: data.firebaseUid,
      authProvider: data.authProvider,
      hasLifetimeAccess: false,
      createdAt: new Date(),
    };
    this.users.set(record.id, record);
    return record;
  }

  async updateUserAuthLink(
    userId: string,
    data: {
      firebaseUid?: string;
      passwordHash?: string;
      authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
    }
  ): Promise<UserRecord> {
    const existing = this.users.get(userId);
    if (!existing) throw new Error("User not found");
    const updated: UserRecord = {
      ...existing,
      firebaseUid: data.firebaseUid ?? existing.firebaseUid,
      passwordHash: data.passwordHash ?? existing.passwordHash,
      authProvider: data.authProvider,
    };
    this.users.set(userId, updated);
    return updated;
  }

  async createSession(data: {
    userId: string;
    tokenHash: string;
    deviceName: string | null;
    userAgent: string | null;
    ipAddressHash: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: `ses_${crypto.randomUUID()}`,
      userId: data.userId,
      tokenHash: data.tokenHash,
      deviceName: data.deviceName,
      userAgent: data.userAgent,
      ipAddressHash: data.ipAddressHash,
      lastActiveAt: new Date(),
      expiresAt: data.expiresAt,
      revokedAt: null,
    };
    this.sessions.set(record.id, record);
    return record;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const s of this.sessions.values()) {
      if (s.tokenHash === tokenHash) return s;
    }
    return null;
  }

  async revokeSession(sessionId: string, revokedAt: Date): Promise<SessionRecord> {
    const existing = this.sessions.get(sessionId);
    if (!existing) throw new Error("Session not found");
    const updated = { ...existing, revokedAt };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async ensureDefaultSchedule(
    userId: string,
    now: Date
  ): Promise<CheckInScheduleRecord> {
    const existing = this.schedules.get(userId);
    if (existing) return existing;
    const schedule: CheckInScheduleRecord = {
      id: `sch_${crypto.randomUUID()}`,
      userId,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      nextDueAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      version: 1,
    };
    this.schedules.set(userId, schedule);
    return schedule;
  }

  async findVaultByUserId(userId: string): Promise<VaultRecord | null> {
    for (const v of this.vaults.values()) {
      if (v.userId === userId) return v;
    }
    return null;
  }

  async findVaultById(vaultId: string): Promise<VaultRecord | null> {
    return this.vaults.get(vaultId) ?? null;
  }

  async createVault(data: {
    userId: string;
    wrappedMasterKeyCiphertext: string;
    wrappedMasterKeyIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
  }): Promise<VaultRecord> {
    const record: VaultRecord = {
      id: `vlt_${crypto.randomUUID()}`,
      userId: data.userId,
      currentKeyVersion: 1,
      wrappedMasterKeyCiphertext: data.wrappedMasterKeyCiphertext,
      wrappedMasterKeyIv: data.wrappedMasterKeyIv,
      kdfSaltBase64: data.kdfSaltBase64,
      kdfAlgorithm: data.kdfAlgorithm,
      createdAt: new Date(),
    };
    this.vaults.set(record.id, record);
    return record;
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
    const record: EncryptedItemRecord = {
      id: `itm_${crypto.randomUUID()}`,
      ...data,
      createdAt: new Date(),
    };
    this.items.set(record.id, record);
    return record;
  }

  async findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null> {
    return this.items.get(itemId) ?? null;
  }

  async listEncryptedItemsByVaultId(vaultId: string): Promise<EncryptedItemRecord[]> {
    return Array.from(this.items.values()).filter((i) => i.vaultId === vaultId);
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
    const record: AuditEventRecord = {
      id: `aud_${crypto.randomUUID()}`,
      userId: data.userId,
      eventType: data.eventType,
      severity: data.severity,
      actorType: data.actorType,
      actorId: data.actorId,
      redactedMeta: data.redactedMeta,
      createdAt: new Date(),
    };
    this.audits.push(record);
    return record;
  }

  async listAuditEventsByUserId(userId: string): Promise<AuditEventRecord[]> {
    return this.audits.filter((a) => a.userId === userId);
  }
}

describe("THE-97: FoundationService End-to-End Flow & Authorization", () => {
  let store: InMemoryFoundationStore;
  let service: FoundationService;

  beforeEach(() => {
    store = new InMemoryFoundationStore();
    service = new FoundationService(store);
  });

  it("registers with email/password, signs in, validates session, and revokes session", async () => {
    const reg = await service.registerWithPassword({
      email: "Ada.Lovelace@Example.com",
      password: "ultra-secure-passphrase-123!",
      fullName: "Ada Lovelace",
      ipAddress: "203.0.113.5",
    });

    expect(reg.user.email).toBe("ada.lovelace@example.com");
    expect(reg.user.authProvider).toBe("PASSWORD");
    expect(reg.schedule.state).toBe("HEALTHY");
    expect(reg.schedule.intervalDays).toBe(90);

    // Authenticate using the issued session token
    const sessionAuth = await service.authenticateSession(reg.sessionToken);
    expect(sessionAuth.user.id).toBe(reg.user.id);

    // Sign in again with email + password
    const login = await service.loginWithPassword({
      email: "ada.lovelace@example.com",
      password: "ultra-secure-passphrase-123!",
    });
    expect(login.user.id).toBe(reg.user.id);
    expect(login.sessionToken).not.toBe(reg.sessionToken);

    // Revoke the first session and confirm it can no longer authenticate
    await service.revokeUserSession(reg.user.id, sessionAuth.session);
    await expect(service.authenticateSession(reg.sessionToken)).rejects.toThrowError(
      AuthenticationError
    );
  });

  it("supports Firebase Google Sign-In and links to existing email accounts as HYBRID", async () => {
    const reg = await service.registerWithPassword({
      email: "satoshi@gmx.com",
      password: "bitcoin-genesis-block-2009!",
      fullName: "Satoshi Nakamoto",
    });

    const googleSync = await service.authenticateWithGoogle({
      email: "satoshi@gmx.com",
      firebaseUid: "firebase_google_uid_999",
      fullName: "Satoshi Nakamoto",
    });

    expect(googleSync.user.id).toBe(reg.user.id);
    expect(googleSync.user.authProvider).toBe("HYBRID");
    expect(googleSync.user.firebaseUid).toBe("firebase_google_uid_999");
  });

  it("creates an empty vault, adds encrypted placeholder records without plaintext, and enforces ownership", async () => {
    const alice = await service.registerWithPassword({
      email: "alice@example.com",
      password: "alice-strong-password-101!",
      fullName: "Alice Owner",
    });

    const mallory = await service.registerWithPassword({
      email: "mallory@example.com",
      password: "mallory-strong-password-202!",
      fullName: "Mallory Attacker",
    });

    // Alice creates an empty zero-knowledge vault
    const vault = await service.createEmptyVault(alice.user.id, {
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 7).toString("base64"),
      wrappedMasterKeyIv: Buffer.alloc(12, 8).toString("base64"),
      kdfSaltBase64: Buffer.alloc(16, 9).toString("base64"),
      kdfAlgorithm: "PBKDF2-SHA256-600000",
    });

    expect(vault.userId).toBe(alice.user.id);

    // Rejects any attempt to send plaintext secrets when adding an item
    await expect(
      service.addEncryptedItem(alice.user.id, {
        vaultId: vault.id,
        secretData: "my plaintext seed phrase",
      })
    ).rejects.toThrowError(TrustBoundaryViolationError);

    // Alice adds a valid encrypted item envelope
    const item = await service.addEncryptedItem(alice.user.id, {
      vaultId: vault.id,
      category: "CRYPTO_RECOVERY",
      ciphertextBase64: Buffer.alloc(64, 1).toString("base64"),
      ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
      wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "res_123",
    });

    // Alice can retrieve her item and list her vault items
    const fetched = await service.getEncryptedItemForOwner(alice.user.id, item.id);
    expect(fetched.id).toBe(item.id);
    const items = await service.listVaultItemsForOwner(alice.user.id, vault.id);
    expect(items).toHaveLength(1);

    // Mallory (another authenticated user) is blocked from reading or adding to Alice's vault
    await expect(
      service.getEncryptedItemForOwner(mallory.user.id, item.id)
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      service.listVaultItemsForOwner(mallory.user.id, vault.id)
    ).rejects.toThrowError(AuthorizationError);

    await expect(
      service.addEncryptedItem(mallory.user.id, {
        vaultId: vault.id,
        category: "SECURE_NOTE",
        ciphertextBase64: Buffer.alloc(64, 1).toString("base64"),
        ivBase64: Buffer.alloc(12, 2).toString("base64"),
        wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
        wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
        aadResourceId: "res_mallory",
      })
    ).rejects.toThrowError(AuthorizationError);

    // Verify audit events never contain plaintext passwords or raw ciphertext
    const audits = await store.listAuditEventsByUserId(alice.user.id);
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const audit of audits) {
      expect(audit.redactedMeta).not.toContain("alice-strong-password-101!");
      expect(audit.redactedMeta).not.toContain(item.ciphertextBase64);
    }
  });
});