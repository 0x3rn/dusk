// lib/services/foundation-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
} from "../auth/security";
import {
  assertZeroKnowledgePayload,
  redactForAuditLog,
  TrustBoundaryViolationError,
} from "../domain/trust-boundary";
import type { ItemCategory, ScheduleState } from "@prisma/client";

/**
 * The identity Neon Auth vouches for. It is validated here because it crosses a trust boundary
 * (the SDK result is parsed from an HTTP response), even though TypeScript types exist.
 */
export const AuthIdentitySchema = z.object({
  authUserId: z.string().min(1).max(200),
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  emailVerified: z.boolean(),
  name: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((n) => (n ? n : null)),
});

export type AuthIdentity = z.input<typeof AuthIdentitySchema>;

export const InitializeVaultInputSchema = z.object({
  wrappedMasterKeyCiphertext: z.string().min(16).max(2_000),
  wrappedMasterKeyIv: z.string().min(12).max(100),
  kdfSaltBase64: z.string().min(16).max(200),
  kdfAlgorithm: z.string().min(1).max(100).default("PBKDF2-SHA256-600000"),
});

export const CreateEncryptedItemInputSchema = z.object({
  vaultId: z.string().min(1).max(64),
  folderId: z.string().min(1).max(64).optional(),
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
  // The cap (about 1.5 MB of ciphertext) keeps one request inside the platform body limit.
  ciphertextBase64: z.string().min(24).max(2_000_000),
  ivBase64: z.string().min(16).max(100),
  wrappedItemKeyBase64: z.string().min(24).max(2_000),
  wrappedItemKeyIvBase64: z.string().min(16).max(100),
  aadResourceId: z.string().min(1).max(200),
});

export interface UserRecord {
  id: string;
  authUserId: string | null;
  email: string;
  fullName: string | null;
  hasLifetimeAccess: boolean;
  createdAt: Date;
}

/**
 * A sign-in session as shown in the Security Center. Sessions are owned by Neon Auth;
 * this is a read-only view of them, never a credential.
 */
export interface SessionRecord {
  id: string;
  userId: string;
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

/** Thrown by the port when a unique constraint (email or authUserId) is violated. */
export class UniqueConstraintError extends Error {
  constructor(message = "Unique constraint violated.") {
    super(message);
    this.name = "UniqueConstraintError";
  }
}

export interface FoundationPersistencePort {
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserByAuthUserId(authUserId: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;
  createUser(data: {
    authUserId: string;
    email: string;
    fullName: string | null;
    emailVerifiedAt: Date | null;
  }): Promise<UserRecord>;
  /** Links an existing unlinked user to a Neon Auth identity. Must not overwrite an existing link. */
  linkAuthIdentity(
    userId: string,
    authUserId: string,
    emailVerifiedAt: Date
  ): Promise<UserRecord>;
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
  findFolderById(folderId: string): Promise<{ id: string; vaultId: string } | null>;
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

export class FoundationService {
  constructor(private readonly store: FoundationPersistencePort) {}

  /**
   * Maps an identity vouched for by Neon Auth to the Dusk user that owns the product data.
   *
   * 1. Known authUserId -> that user.
   * 2. Unknown authUserId but an existing Dusk user with the same email -> link them, but ONLY
   *    when Neon Auth reports the email as verified. Linking on an unverified email would let
   *    anyone who signs up with a victim's address take over the victim's vault record.
   * 3. Otherwise create a new user with the default check-in schedule.
   *
   * Safe to call concurrently: a lost creation race is detected through the unique constraint
   * and resolved by re-reading.
   */
  async resolveUserFromIdentity(rawIdentity: unknown): Promise<UserRecord> {
    const parsed = AuthIdentitySchema.safeParse(rawIdentity);
    if (!parsed.success) {
      throw new AuthenticationError("Invalid identity from the authentication provider.");
    }
    const identity = parsed.data;
    const now = new Date();

    const existingByAuthId = await this.store.findUserByAuthUserId(identity.authUserId);
    if (existingByAuthId) {
      return existingByAuthId;
    }

    const existingByEmail = await this.store.findUserByEmail(identity.email);
    if (existingByEmail) {
      if (existingByEmail.authUserId && existingByEmail.authUserId !== identity.authUserId) {
        throw new AuthenticationError(
          "This email is already linked to a different sign-in identity.",
          "IDENTITY_CONFLICT"
        );
      }
      if (!identity.emailVerified) {
        throw new AuthenticationError(
          "Verify your email address to access your existing Dusk account.",
          "EMAIL_NOT_VERIFIED"
        );
      }
      const linked = await this.store.linkAuthIdentity(
        existingByEmail.id,
        identity.authUserId,
        now
      );
      await this.store.ensureDefaultSchedule(linked.id, now);
      await this.recordAudit(linked.id, "AUTH_IDENTITY_LINKED", "INFO", {
        authUserId: identity.authUserId,
      });
      return linked;
    }

    try {
      const created = await this.store.createUser({
        authUserId: identity.authUserId,
        email: identity.email,
        fullName: identity.name,
        emailVerifiedAt: identity.emailVerified ? now : null,
      });
      await this.store.ensureDefaultSchedule(created.id, now);
      await this.recordAudit(created.id, "ACCOUNT_CREATED", "INFO", {
        authUserId: identity.authUserId,
      });
      return created;
    } catch (err) {
      if (!(err instanceof UniqueConstraintError)) throw err;
      const winner =
        (await this.store.findUserByAuthUserId(identity.authUserId)) ??
        (await this.store.findUserByEmail(identity.email));
      if (!winner) throw err;
      return winner;
    }
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

    // A folder id from the request is only usable if the folder sits in this same vault, so an
    // item can never be filed under another account's folder.
    if (input.folderId) {
      const folder = await this.store.findFolderById(input.folderId);
      if (!folder || folder.vaultId !== vault.id) {
        throw new ValidationError("Folder not found.");
      }
    }

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