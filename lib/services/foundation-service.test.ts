// lib/services/foundation-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthenticationError,
  AuthorizationError,
  FoundationService,
  TrustBoundaryViolationError,
  UniqueConstraintError,
  ValidationError,
  type AuditEventRecord,
  type CheckInScheduleRecord,
  type EncryptedItemRecord,
  type FoundationPersistencePort,
  type UserRecord,
  type VaultRecord,
} from "./foundation-service";

class InMemoryFoundationStore implements FoundationPersistencePort {
  public users = new Map<string, UserRecord>();
  public schedules = new Map<string, CheckInScheduleRecord>();
  public vaults = new Map<string, VaultRecord>();
  public items = new Map<string, EncryptedItemRecord>();
  public folders = new Map<string, { id: string; vaultId: string }>();
  public audits: AuditEventRecord[] = [];

  /** Set by a test to simulate another request winning the creation race. */
  public beforeCreateUser: (() => void) | null = null;

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.email === email) return u;
    }
    return null;
  }

  async findUserByAuthUserId(authUserId: string): Promise<UserRecord | null> {
    for (const u of this.users.values()) {
      if (u.authUserId === authUserId) return u;
    }
    return null;
  }

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async createUser(data: {
    authUserId: string;
    email: string;
    fullName: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<UserRecord> {
    this.beforeCreateUser?.();
    for (const u of this.users.values()) {
      if (u.email === data.email || u.authUserId === data.authUserId) {
        throw new UniqueConstraintError();
      }
    }
    const record: UserRecord = {
      id: `usr_${crypto.randomUUID()}`,
      authUserId: data.authUserId,
      email: data.email,
      fullName: data.fullName,
      hasLifetimeAccess: false,
      createdAt: new Date(),
    };
    this.users.set(record.id, record);
    return record;
  }

  /** Test helper: an account that existed before Neon Auth (no authUserId yet). */
  seedLegacyUser(email: string): UserRecord {
    const record: UserRecord = {
      id: `usr_${crypto.randomUUID()}`,
      authUserId: null,
      email,
      fullName: "Legacy Owner",
      hasLifetimeAccess: false,
      createdAt: new Date(),
    };
    this.users.set(record.id, record);
    return record;
  }

  async linkAuthIdentity(userId: string, authUserId: string): Promise<UserRecord> {
    const existing = this.users.get(userId);
    if (!existing) throw new Error("User not found");
    if (existing.authUserId) throw new UniqueConstraintError("Already linked.");
    const updated = { ...existing, authUserId };
    this.users.set(userId, updated);
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

  async findFolderById(folderId: string) {
    return this.folders.get(folderId) ?? null;
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

const identity = (over: Record<string, unknown> = {}) => ({
  authUserId: "neon_user_1",
  email: "Ada.Lovelace@Example.com",
  emailVerified: true,
  name: "Ada Lovelace",
  ...over,
});

describe("FoundationService: Neon Auth identity -> Dusk user", () => {
  let store: InMemoryFoundationStore;
  let service: FoundationService;

  beforeEach(() => {
    store = new InMemoryFoundationStore();
    service = new FoundationService(store);
  });

  it("creates a user with a default 90-day schedule on first sign-in and normalizes email", async () => {
    const user = await service.resolveUserFromIdentity(identity());

    expect(user.email).toBe("ada.lovelace@example.com");
    expect(user.authUserId).toBe("neon_user_1");
    expect(user.fullName).toBe("Ada Lovelace");
    const schedule = store.schedules.get(user.id);
    expect(schedule?.state).toBe("HEALTHY");
    expect(schedule?.intervalDays).toBe(90);
    const events = (await store.listAuditEventsByUserId(user.id)).map((a) => a.eventType);
    expect(events).toContain("ACCOUNT_CREATED");
  });

  it("is idempotent: a second call returns the same user and creates nothing", async () => {
    const first = await service.resolveUserFromIdentity(identity());
    const second = await service.resolveUserFromIdentity(identity());

    expect(second.id).toBe(first.id);
    expect(store.users.size).toBe(1);
  });

  it("links a pre-existing account by VERIFIED email and keeps its id", async () => {
    const legacy = store.seedLegacyUser("ada.lovelace@example.com");

    const user = await service.resolveUserFromIdentity(identity());

    expect(user.id).toBe(legacy.id);
    expect(user.authUserId).toBe("neon_user_1");
    expect(store.users.size).toBe(1);
    const events = (await store.listAuditEventsByUserId(legacy.id)).map((a) => a.eventType);
    expect(events).toContain("AUTH_IDENTITY_LINKED");
  });

  it("refuses to link a pre-existing account when the email is NOT verified (takeover guard)", async () => {
    const legacy = store.seedLegacyUser("ada.lovelace@example.com");

    await expect(
      service.resolveUserFromIdentity(identity({ emailVerified: false }))
    ).rejects.toMatchObject({ name: "AuthenticationError", code: "EMAIL_NOT_VERIFIED" });

    expect(store.users.get(legacy.id)?.authUserId).toBeNull();
  });

  it("refuses a second Neon identity claiming an email already linked to someone else", async () => {
    await service.resolveUserFromIdentity(identity());

    await expect(
      service.resolveUserFromIdentity(identity({ authUserId: "neon_attacker" }))
    ).rejects.toMatchObject({ name: "AuthenticationError", code: "IDENTITY_CONFLICT" });
  });

  it("recovers when a concurrent request wins the creation race", async () => {
    store.beforeCreateUser = () => {
      store.beforeCreateUser = null;
      store.users.set("usr_winner", {
        id: "usr_winner",
        authUserId: "neon_user_1",
        email: "ada.lovelace@example.com",
        fullName: "Ada Lovelace",
        hasLifetimeAccess: false,
        createdAt: new Date(),
      });
    };

    const user = await service.resolveUserFromIdentity(identity());

    expect(user.id).toBe("usr_winner");
    expect(store.users.size).toBe(1);
  });

  it.each([
    ["empty id", { authUserId: "" }],
    ["bad email", { email: "not-an-email" }],
    ["non-boolean verified flag", { emailVerified: "yes" }],
  ])("rejects a malformed identity: %s", async (_label, over) => {
    await expect(service.resolveUserFromIdentity(identity(over))).rejects.toBeInstanceOf(
      AuthenticationError
    );
    expect(store.users.size).toBe(0);
  });

  it("rejects non-object identities", async () => {
    await expect(service.resolveUserFromIdentity(null)).rejects.toBeInstanceOf(
      AuthenticationError
    );
  });
});

describe("FoundationService: vault creation and ownership", () => {
  let store: InMemoryFoundationStore;
  let service: FoundationService;

  beforeEach(() => {
    store = new InMemoryFoundationStore();
    service = new FoundationService(store);
  });

  it("creates an empty vault, adds encrypted records without plaintext, and enforces ownership", async () => {
    const alice = await service.resolveUserFromIdentity({
      authUserId: "neon_alice",
      email: "alice@example.com",
      emailVerified: true,
      name: "Alice Owner",
    });
    const mallory = await service.resolveUserFromIdentity({
      authUserId: "neon_mallory",
      email: "mallory@example.com",
      emailVerified: true,
      name: "Mallory Attacker",
    });

    const vault = await service.createEmptyVault(alice.id, {
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 7).toString("base64"),
      wrappedMasterKeyIv: Buffer.alloc(12, 8).toString("base64"),
      kdfSaltBase64: Buffer.alloc(16, 9).toString("base64"),
      kdfAlgorithm: "PBKDF2-SHA256-600000",
    });
    expect(vault.userId).toBe(alice.id);

    // Plaintext secrets are rejected at the trust boundary.
    await expect(
      service.addEncryptedItem(alice.id, {
        vaultId: vault.id,
        secretData: "my plaintext seed phrase",
      })
    ).rejects.toThrowError(TrustBoundaryViolationError);

    const envelope = {
      vaultId: vault.id,
      category: "CRYPTO_RECOVERY",
      ciphertextBase64: Buffer.alloc(64, 1).toString("base64"),
      ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
      wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "res_123",
    };
    const item = await service.addEncryptedItem(alice.id, envelope);

    expect((await service.getEncryptedItemForOwner(alice.id, item.id)).id).toBe(item.id);
    expect(await service.listVaultItemsForOwner(alice.id, vault.id)).toHaveLength(1);

    // Another authenticated user cannot read or write Alice's vault.
    await expect(
      service.getEncryptedItemForOwner(mallory.id, item.id)
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      service.listVaultItemsForOwner(mallory.id, vault.id)
    ).rejects.toThrowError(AuthorizationError);
    await expect(
      service.addEncryptedItem(mallory.id, { ...envelope, aadResourceId: "res_mallory" })
    ).rejects.toThrowError(AuthorizationError);

    // Audit events never contain raw ciphertext.
    const audits = await store.listAuditEventsByUserId(alice.id);
    expect(audits.length).toBeGreaterThanOrEqual(3);
    for (const audit of audits) {
      expect(audit.redactedMeta).not.toContain(item.ciphertextBase64);
    }
  });

  it("refuses a folder that belongs to another vault and oversized envelopes", async () => {
    const alice = await service.resolveUserFromIdentity(identity());
    const bob = await service.resolveUserFromIdentity(identity({ authUserId: "neon_bob", email: "bob@example.com" }));
    const bundle = {
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 7).toString("base64"),
      wrappedMasterKeyIv: Buffer.alloc(12, 8).toString("base64"),
      kdfSaltBase64: Buffer.alloc(16, 9).toString("base64"),
    };
    const aliceVault = await service.createEmptyVault(alice.id, bundle);
    const bobVault = await service.createEmptyVault(bob.id, bundle);
    store.folders.set("fld_alice", { id: "fld_alice", vaultId: aliceVault.id });
    store.folders.set("fld_bob", { id: "fld_bob", vaultId: bobVault.id });
    const envelope = {
      vaultId: aliceVault.id,
      ciphertextBase64: Buffer.alloc(64, 1).toString("base64"),
      ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"),
      wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "res_1",
    };

    expect((await service.addEncryptedItem(alice.id, { ...envelope, folderId: "fld_alice" })).folderId).toBe("fld_alice");
    await expect(service.addEncryptedItem(alice.id, { ...envelope, folderId: "fld_bob" })).rejects.toThrowError(
      ValidationError
    );
    await expect(service.addEncryptedItem(alice.id, { ...envelope, folderId: "fld_missing" })).rejects.toThrowError(
      ValidationError
    );
    await expect(
      service.addEncryptedItem(alice.id, { ...envelope, ciphertextBase64: "A".repeat(2_000_004) })
    ).rejects.toThrowError(ValidationError);
    expect(await service.listVaultItemsForOwner(alice.id, aliceVault.id)).toHaveLength(1);
  });

  it("rejects vault creation for an unauthenticated caller and a duplicate vault", async () => {
    await expect(service.createEmptyVault(null, {})).rejects.toBeInstanceOf(AuthenticationError);

    const user = await service.resolveUserFromIdentity(identity());
    const bundle = {
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 7).toString("base64"),
      wrappedMasterKeyIv: Buffer.alloc(12, 8).toString("base64"),
      kdfSaltBase64: Buffer.alloc(16, 9).toString("base64"),
    };
    await service.createEmptyVault(user.id, bundle);
    await expect(service.createEmptyVault(user.id, bundle)).rejects.toThrowError(
      /already has an initialized vault/
    );
  });
});
