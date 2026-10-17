// lib/services/foundation-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
  generateOpaqueToken,
  hashIpAddress,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from "../auth/security";
import {
  assertZeroKnowledgePayload,
  redactForAuditLog,
  TrustBoundaryViolationError,
} from "../domain/trust-boundary";
import type { ItemCategory, ScheduleState } from "@prisma/client";

export const RegisterWithPasswordInputSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(10, "Password must be at least 10 characters"),
  fullName: z.string().trim().min(1, "Full name is required").max(120),
  deviceName: z.string().max(120).optional(),
  userAgent: z.string().max(500).optional(),
  ipAddress: z.string().max(100).optional(),
});

export const LoginWithPasswordInputSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  password: z.string().min(1),
  deviceName: z.string().max(120).optional(),
  userAgent: z.string().max(500).optional(),
  ipAddress: z.string().max(100).optional(),
});

export const GoogleAuthSyncInputSchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  firebaseUid: z.string().min(4),
  fullName: z.string().trim().min(1).max(120).optional(),
  deviceName: z.string().max(120).optional(),
  userAgent: z.string().max(500).optional(),
  ipAddress: z.string().max(100).optional(),
});

export const InitializeVaultInputSchema = z.object({
  wrappedMasterKeyCiphertext: z.string().min(16),
  wrappedMasterKeyIv: z.string().min(12),
  kdfSaltBase64: z.string().min(16),
  kdfAlgorithm: z.string().min(1).default("PBKDF2-SHA256-600000"),
});

export const CreateEncryptedItemInputSchema = z.object({
  vaultId: z.string().min(1),
  folderId: z.string().optional(),
  category: z
    .enum([
      "CREDENTIAL",
      "CRYPTO_RECOVERY",
      "DOCUMENT",
      "DEVICE_ACCESS",
      "FINANCIAL_INSTRUCTION",
      "FINAL_WISH",
      "SECURE_NOTE",
    ])
    .default("SECURE_NOTE"),
  schemaVersion: z.number().int().positive().default(1),
  keyVersion: z.number().int().positive().default(1),
  ciphertextBase64: z.string().min(24),
  ivBase64: z.string().min(16),
  wrappedItemKeyBase64: z.string().min(24),
  wrappedItemKeyIvBase64: z.string().min(16),
  aadResourceId: z.string().min(1),
});

export interface UserRecord {
  id: string;
  email: string;
  fullName: string | null;
  passwordHash: string | null;
  firebaseUid: string | null;
  authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
  hasLifetimeAccess: boolean;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddressHash: string | null;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface VaultRecord {
  id: string;
  userId: string;
  currentKeyVersion: number;
  wrappedMasterKeyCiphertext: string;
  wrappedMasterKeyIv: string;
  kdfSaltBase64: string;
  kdfAlgorithm: string;
  createdAt: Date;
}

export interface EncryptedItemRecord {
  id: string;
  vaultId: string;
  userId: string;
  folderId: string | null;
  category: ItemCategory;
  schemaVersion: number;
  keyVersion: number;
  ciphertextBase64: string;
  ivBase64: string;
  wrappedItemKeyBase64: string;
  wrappedItemKeyIvBase64: string;
  aadResourceId: string;
  createdAt: Date;
}

export interface CheckInScheduleRecord {
  id: string;
  userId: string;
  state: ScheduleState;
  intervalDays: number;
  gracePeriodDays: number;
  nextDueAt: Date;
  version: number;
}

export interface AuditEventRecord {
  id: string;
  userId: string;
  eventType: string;
  severity: string;
  actorType: string;
  actorId: string | null;
  redactedMeta: string;
  createdAt: Date;
}

export interface FoundationPersistencePort {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByFirebaseUid(firebaseUid: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(data: {
    email: string;
    fullName: string | null;
    passwordHash: string | null;
    firebaseUid: string | null;
    authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
  }): Promise<UserRecord>;
  updateUserAuthLink(
    userId: string,
    data: {
      firebaseUid?: string;
      passwordHash?: string;
      authProvider: "PASSWORD" | "GOOGLE" | "HYBRID";
    }
  ): Promise<UserRecord>;
  createSession(data: {
    userId: string;
    tokenHash: string;
    deviceName: string | null;
    userAgent: string | null;
    ipAddressHash: string | null;
    expiresAt: Date;
  }): Promise<SessionRecord>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(sessionId: string, revokedAt: Date): Promise<SessionRecord>;
  ensureDefaultSchedule(userId: string, now: Date): Promise<CheckInScheduleRecord>;
  findVaultByUserId(userId: string): Promise<VaultRecord | null>;
  findVaultById(vaultId: string): Promise<VaultRecord | null>;
  createVault(data: {
    userId: string;
    wrappedMasterKeyCiphertext: string;
    wrappedMasterKeyIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
  }): Promise<VaultRecord>;
  createEncryptedItem(data: {
    vaultId: string;
    userId: string;
    folderId: string | null;
    category: ItemCategory;
    schemaVersion: number;
    keyVersion: number;
    ciphertextBase64: string;
    ivBase64: string;
    wrappedItemKeyBase64: string;
    wrappedItemKeyIvBase64: string;
    aadResourceId: string;
  }): Promise<EncryptedItemRecord>;
  findEncryptedItemById(itemId: string): Promise<EncryptedItemRecord | null>;
  listEncryptedItemsByVaultId(vaultId: string): Promise<EncryptedItemRecord[]>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    actorType: string;
    actorId: string | null;
    ipAddressHash: string | null;
    userAgent: string | null;
    redactedMeta: string;
  }): Promise<AuditEventRecord>;
  listAuditEventsByUserId(userId: string): Promise<AuditEventRecord[]>;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export class FoundationService {
  constructor(private readonly store: FoundationPersistencePort) {}

  /**
   * Registers a new user with Email + Password in Neon PostgreSQL,
   * initializes their default 90-day check-in schedule, and creates a session.
   */
  async registerWithPassword(rawInput: unknown): Promise<{
    user: Omit<UserRecord, "passwordHash">;
    sessionToken: string;
    schedule: CheckInScheduleRecord;
  }> {
    const parsed = RegisterWithPasswordInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid registration input");
    }
    const input = parsed.data;

    const existing = await this.store.findUserByEmail(input.email);
    if (existing && existing.passwordHash) {
      throw new ValidationError("An account with this email already exists.");
    }

    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    let user: UserRecord;
    if (existing && existing.firebaseUid && !existing.passwordHash) {
      // Upgrade existing Google-only account to HYBRID
      user = await this.store.updateUserAuthLink(existing.id, {
        passwordHash,
        authProvider: "HYBRID",
      });
    } else {
      user = await this.store.createUser({
        email: input.email,
        fullName: input.fullName,
        passwordHash,
        firebaseUid: null,
        authProvider: "PASSWORD",
      });
    }

    const schedule = await this.store.ensureDefaultSchedule(user.id, now);
    const { rawToken, tokenHash } = generateOpaqueToken();
    const ipHash = input.ipAddress ? hashIpAddress(input.ipAddress) : null;

    await this.store.createSession({
      userId: user.id,
      tokenHash,
      deviceName: input.deviceName ?? "Web Browser",
      userAgent: input.userAgent ?? null,
      ipAddressHash: ipHash,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });

    await this.recordAudit(user.id, "ACCOUNT_REGISTERED_PASSWORD", "INFO", {
      email: user.email,
      authProvider: user.authProvider,
      password: input.password, // Explicitly tested to ensure redactForAuditLog strips it
    });

    const { passwordHash: _omitted, ...safeUser } = user;
    return { user: safeUser, sessionToken: rawToken, schedule };
  }

  /**
   * Authenticates an existing user via Neon PostgreSQL Email + Password.
   */
  async loginWithPassword(rawInput: unknown): Promise<{
    user: Omit<UserRecord, "passwordHash">;
    sessionToken: string;
  }> {
    const parsed = LoginWithPasswordInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid email or password format.");
    }
    const input = parsed.data;

    const user = await this.store.findUserByEmail(input.email);
    if (!user || !user.passwordHash) {
      throw new AuthenticationError("Invalid email or password.");
    }

    const valid = await verifyPassword(input.password, user.passwordHash);
    if (!valid) {
      await this.recordAudit(user.id, "AUTH_LOGIN_FAILED", "WARN", {
        reason: "INVALID_PASSWORD",
      });
      throw new AuthenticationError("Invalid email or password.");
    }

    const now = new Date();
    const { rawToken, tokenHash } = generateOpaqueToken();
    const ipHash = input.ipAddress ? hashIpAddress(input.ipAddress) : null;

    await this.store.createSession({
      userId: user.id,
      tokenHash,
      deviceName: input.deviceName ?? "Web Browser",
      userAgent: input.userAgent ?? null,
      ipAddressHash: ipHash,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });

    await this.recordAudit(user.id, "AUTH_LOGIN_SUCCESS", "INFO", {
      method: "PASSWORD",
    });

    const { passwordHash: _omitted, ...safeUser } = user;
    return { user: safeUser, sessionToken: rawToken };
  }

  /**
   * Synchronizes a Firebase Google Sign-In / Sign-Up into Neon PostgreSQL
   * and issues a server-tracked Dusk session token.
   */
  async authenticateWithGoogle(rawInput: unknown): Promise<{
    user: Omit<UserRecord, "passwordHash">;
    sessionToken: string;
    schedule: CheckInScheduleRecord;
  }> {
    const parsed = GoogleAuthSyncInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid Google authentication payload.");
    }
    const input = parsed.data;

    let user = await this.store.findUserByFirebaseUid(input.firebaseUid);
    if (!user) {
      const byEmail = await this.store.findUserByEmail(input.email);
      if (byEmail) {
        user = await this.store.updateUserAuthLink(byEmail.id, {
          firebaseUid: input.firebaseUid,
          authProvider: byEmail.passwordHash ? "HYBRID" : "GOOGLE",
        });
      } else {
        user = await this.store.createUser({
          email: input.email,
          fullName: input.fullName ?? null,
          passwordHash: null,
          firebaseUid: input.firebaseUid,
          authProvider: "GOOGLE",
        });
      }
    }

    const now = new Date();
    const schedule = await this.store.ensureDefaultSchedule(user.id, now);
    const { rawToken, tokenHash } = generateOpaqueToken();
    const ipHash = input.ipAddress ? hashIpAddress(input.ipAddress) : null;

    await this.store.createSession({
      userId: user.id,
      tokenHash,
      deviceName: input.deviceName ?? "Google Web Session",
      userAgent: input.userAgent ?? null,
      ipAddressHash: ipHash,
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    });

    await this.recordAudit(user.id, "AUTH_GOOGLE_SYNC", "INFO", {
      firebaseUid: input.firebaseUid,
      authProvider: user.authProvider,
    });

    const { passwordHash: _omitted, ...safeUser } = user;
    return { user: safeUser, sessionToken: rawToken, schedule };
  }

  /**
   * Validates an opaque session token against Neon PostgreSQL.
   * Rejects expired, unknown, or revoked sessions.
   */
  async authenticateSession(
    rawToken: string | null | undefined,
    now = new Date()
  ): Promise<{ user: Omit<UserRecord, "passwordHash">; session: SessionRecord }> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new AuthenticationError("Missing session token.");
    }

    const tokenHash = hashOpaqueToken(rawToken);
    const session = await this.store.findSessionByTokenHash(tokenHash);

    if (!session) {
      throw new AuthenticationError("Invalid session token.");
    }

    if (session.revokedAt !== null) {
      throw new AuthenticationError("Session has been revoked.");
    }

    if (session.expiresAt.getTime() <= now.getTime()) {
      throw new AuthenticationError("Session has expired.");
    }

    const user = await this.store.findUserById(session.userId);
    if (!user) {
      throw new AuthenticationError("User for session no longer exists.");
    }

    const { passwordHash: _omitted, ...safeUser } = user;
    return { user: safeUser, session };
  }

  /**
   * Revokes a session after verifying the authenticated user owns that session.
   */
  async revokeUserSession(
    authenticatedUserId: string,
    sessionToRevoke: SessionRecord
  ): Promise<SessionRecord> {
    assertResourceOwnership(sessionToRevoke, authenticatedUserId, "Session");
    const revoked = await this.store.revokeSession(sessionToRevoke.id, new Date());
    await this.recordAudit(authenticatedUserId, "SESSION_REVOKED", "INFO", {
      revokedSessionId: sessionToRevoke.id,
    });
    return revoked;
  }

  /**
   * Creates an empty zero-knowledge vault for the authenticated user.
   * Rejects any payload containing raw master keys or plaintext secrets.
   */
  async createEmptyVault(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<VaultRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    // Enforce zero-knowledge boundary first (THE-96)
    assertZeroKnowledgePayload(rawInput);

    const parsed = InitializeVaultInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid vault initialization parameters"
      );
    }

    const existing = await this.store.findVaultByUserId(authenticatedUserId);
    if (existing) {
      throw new ValidationError("User already has an initialized vault.");
    }

    const vault = await this.store.createVault({
      userId: authenticatedUserId,
      wrappedMasterKeyCiphertext: parsed.data.wrappedMasterKeyCiphertext,
      wrappedMasterKeyIv: parsed.data.wrappedMasterKeyIv,
      kdfSaltBase64: parsed.data.kdfSaltBase64,
      kdfAlgorithm: parsed.data.kdfAlgorithm,
    });

    await this.recordAudit(authenticatedUserId, "VAULT_INITIALIZED", "INFO", {
      vaultId: vault.id,
      kdfAlgorithm: vault.kdfAlgorithm,
    });

    return vault;
  }

/**
   * Adds an encrypted item record to a vault after verifying:
   * 1. Zero-knowledge payload rules (no plaintext fields).
   * 2. The authenticated user is the owner of the target vault.
   */
  async addEncryptedItem(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<EncryptedItemRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    // 1. Reject any plaintext leakage at the boundary
    assertZeroKnowledgePayload(rawInput);

    const parsed = CreateEncryptedItemInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid encrypted item envelope"
      );
    }
    const input = parsed.data;

    // 2. Verify vault exists and belongs to authenticatedUserId
    const vault = assertResourceOwnership(
      await this.store.findVaultById(input.vaultId),
      authenticatedUserId,
      "Vault"
    );

    const item = await this.store.createEncryptedItem({
      vaultId: vault.id,
      userId: authenticatedUserId,
      folderId: input.folderId ?? null,
      category: input.category,
      schemaVersion: input.schemaVersion,
      keyVersion: input.keyVersion,
      ciphertextBase64: input.ciphertextBase64,
      ivBase64: input.ivBase64,
      wrappedItemKeyBase64: input.wrappedItemKeyBase64,
      wrappedItemKeyIvBase64: input.wrappedItemKeyIvBase64,
      aadResourceId: input.aadResourceId,
    });

    await this.recordAudit(authenticatedUserId, "VAULT_ITEM_CREATED", "INFO", {
      vaultId: vault.id,
      itemId: item.id,
      category: item.category,
      ciphertextBase64: item.ciphertextBase64, // Redacted automatically by recordAudit
    });

    return item;
  }

  /**
   * Retrieves an encrypted item only if the caller owns it.
   */
  async getEncryptedItemForOwner(
    authenticatedUserId: string | null | undefined,
    itemId: string
  ): Promise<EncryptedItemRecord> {
    const item = await this.store.findEncryptedItemById(itemId);
    return assertResourceOwnership(item, authenticatedUserId, "EncryptedItem");
  }

  /**
   * Lists encrypted items for a vault only if the caller owns the vault.
   */
  async listVaultItemsForOwner(
    authenticatedUserId: string | null | undefined,
    vaultId: string
  ): Promise<EncryptedItemRecord[]> {
    const vault = assertResourceOwnership(
      await this.store.findVaultById(vaultId),
      authenticatedUserId,
      "Vault"
    );
    return this.store.listEncryptedItemsByVaultId(vault.id);
  }

  private async recordAudit(
    userId: string,
    eventType: string,
    severity: "INFO" | "WARN" | "CRITICAL",
    metadata: Record<string, unknown>
  ): Promise<void> {
    const redacted = redactForAuditLog(metadata);
    await this.store.appendAuditEvent({
      userId,
      eventType,
      severity,
      actorType: "USER",
      actorId: userId,
      ipAddressHash: null,
      userAgent: null,
      redactedMeta: JSON.stringify(redacted),
    });
  }
}

export {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  TrustBoundaryViolationError,
};