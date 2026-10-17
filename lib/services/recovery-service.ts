// lib/services/recovery-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
  generateOpaqueToken,
} from "../auth/security";
import {
  assertZeroKnowledgePayload,
  redactForAuditLog,
} from "../domain/trust-boundary";

export const StoreRecoveryArtifactInputSchema = z.object({
  keyVersion: z.number().int().positive(),
  recoveryWrappedVmKBase64: z.string().min(24),
  recoveryWrappedVmKIv: z.string().min(16),
  kdfSaltBase64: z.string().min(16),
  kdfAlgorithm: z.string().min(1),
  fingerprintHex: z.string().regex(/^[a-f0-9]{16}$/, "Invalid 16-char hex fingerprint"),
  confirmIrreversibleRotation: z.boolean().refine((val) => val === true, {
    message:
      "Explicit confirmation (confirmIrreversibleRotation: true) is required before rotating or replacing recovery material.",
  }),
});

export const CompleteRecoveryReEnrollmentInputSchema = z.object({
  artifactId: z.string().min(1),
  fingerprintHex: z.string().regex(/^[a-f0-9]{16}$/),
  newWrappedMasterKeyCiphertext: z.string().min(24),
  newWrappedMasterKeyIv: z.string().min(16),
  newKdfSaltBase64: z.string().min(16),
  newKdfAlgorithm: z.string().min(1),
  newDeviceName: z.string().min(1).max(120).default("Recovered Device"),
  revokeAllExistingSessions: z.boolean().default(true),
});

export interface RecoveryArtifactRecord {
  id: string;
  userId: string;
  keyVersion: number;
  recoveryWrappedVmKBase64: string;
  recoveryWrappedVmKIv: string;
  kdfSaltBase64: string;
  kdfAlgorithm: string;
  fingerprintHex: string;
  isActive: boolean;
  revokedAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
}

export interface RecoveryPersistencePort {
  listActiveArtifactsByUserId(userId: string): Promise<RecoveryArtifactRecord[]>;
  findArtifactById(artifactId: string): Promise<RecoveryArtifactRecord | null>;
  deactivateAllUserArtifacts(userId: string, revokedAt: Date): Promise<number>;
  createRecoveryArtifact(data: {
    userId: string;
    keyVersion: number;
    recoveryWrappedVmKBase64: string;
    recoveryWrappedVmKIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
    fingerprintHex: string;
  }): Promise<RecoveryArtifactRecord>;
  markArtifactVerified(artifactId: string, verifiedAt: Date): Promise<RecoveryArtifactRecord>;
  updateVaultWrappedMasterKey(
    userId: string,
    data: {
      wrappedMasterKeyCiphertext: string;
      wrappedMasterKeyIv: string;
      kdfSaltBase64: string;
      kdfAlgorithm: string;
    }
  ): Promise<void>;
  revokeAllUserSessions(userId: string, revokedAt: Date): Promise<number>;
  createSession(data: {
    userId: string;
    tokenHash: string;
    deviceName: string;
    expiresAt: Date;
  }): Promise<{ id: string }>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class RecoveryArtifactRevokedError extends Error {
  public readonly code = "RECOVERY_ARTIFACT_REVOKED";
  constructor(message = "This Recovery Kit has been revoked or superseded by a newer kit.") {
    super(message);
    this.name = "RecoveryArtifactRevokedError";
  }
}

export class RecoveryService {
  constructor(private readonly store: RecoveryPersistencePort) {}

  async registerOrRotateRecoveryArtifact(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<{
    artifact: RecoveryArtifactRecord;
    revokedPreviousCount: number;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);
    if (
      typeof rawInput === "object" &&
      rawInput !== null &&
      "recoveryCode" in (rawInput as Record<string, unknown>)
    ) {
      throw new ValidationError(
        "Zero-knowledge violation: recoveryCode must never be sent to the server."
      );
    }

    const parsed = StoreRecoveryArtifactInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid recovery artifact input."
      );
    }
    const input = parsed.data;
    const now = new Date();

    const revokedPreviousCount = await this.store.deactivateAllUserArtifacts(
      authenticatedUserId,
      now
    );

    const artifact = await this.store.createRecoveryArtifact({
      userId: authenticatedUserId,
      keyVersion: input.keyVersion,
      recoveryWrappedVmKBase64: input.recoveryWrappedVmKBase64,
      recoveryWrappedVmKIv: input.recoveryWrappedVmKIv,
      kdfSaltBase64: input.kdfSaltBase64,
      kdfAlgorithm: input.kdfAlgorithm,
      fingerprintHex: input.fingerprintHex,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType:
        revokedPreviousCount > 0 ? "RECOVERY_KIT_ROTATED" : "RECOVERY_KIT_CREATED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          artifactId: artifact.id,
          keyVersion: artifact.keyVersion,
          fingerprintHex: artifact.fingerprintHex,
          revokedPreviousCount,
        })
      ),
    });

    return { artifact, revokedPreviousCount };
  }

  async revokeRecoveryArtifact(
    authenticatedUserId: string | null | undefined,
    artifactId: string,
    confirmRevocation: boolean
  ): Promise<void> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }
    if (!confirmRevocation) {
      throw new ValidationError(
        "Explicit confirmation is required to revoke a Recovery Kit."
      );
    }

    const artifact = assertResourceOwnership(
      await this.store.findArtifactById(artifactId),
      authenticatedUserId,
      "RecoveryArtifact"
    );

    await this.store.deactivateAllUserArtifacts(artifact.userId, new Date());
    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "RECOVERY_KIT_REVOKED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        artifactId: artifact.id,
        fingerprintHex: artifact.fingerprintHex,
      }),
    });
  }

  async getActiveArtifactForRecovery(
    authenticatedUserId: string | null | undefined,
    artifactId: string
  ): Promise<RecoveryArtifactRecord> {
    const artifact = assertResourceOwnership(
      await this.store.findArtifactById(artifactId),
      authenticatedUserId,
      "RecoveryArtifact"
    );

    if (!artifact.isActive || artifact.revokedAt !== null) {
      throw new RecoveryArtifactRevokedError();
    }

    return artifact;
  }

  async completeRecoveryReEnrollment(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<{
    newSessionToken: string;
    revokedSessionsCount: number;
    verifiedArtifact: RecoveryArtifactRecord;
  }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    assertZeroKnowledgePayload(rawInput);

    const parsed = CompleteRecoveryReEnrollmentInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid recovery re-enrollment payload."
      );
    }
    const input = parsed.data;

    const artifact = await this.getActiveArtifactForRecovery(
      authenticatedUserId,
      input.artifactId
    );

    if (artifact.fingerprintHex !== input.fingerprintHex) {
      throw new AuthorizationError("Recovery kit fingerprint mismatch.");
    }

    const now = new Date();

    await this.store.updateVaultWrappedMasterKey(authenticatedUserId, {
      wrappedMasterKeyCiphertext: input.newWrappedMasterKeyCiphertext,
      wrappedMasterKeyIv: input.newWrappedMasterKeyIv,
      kdfSaltBase64: input.newKdfSaltBase64,
      kdfAlgorithm: input.newKdfAlgorithm,
    });

    const verifiedArtifact = await this.store.markArtifactVerified(artifact.id, now);

    let revokedSessionsCount = 0;
    if (input.revokeAllExistingSessions) {
      revokedSessionsCount = await this.store.revokeAllUserSessions(
        authenticatedUserId,
        now
      );
    }

    const { rawToken, tokenHash } = generateOpaqueToken();
    await this.store.createSession({
      userId: authenticatedUserId,
      tokenHash,
      deviceName: input.newDeviceName,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "RECOVERY_RE_ENROLLMENT_COMPLETED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify(
        redactForAuditLog({
          artifactId: artifact.id,
          fingerprintHex: artifact.fingerprintHex,
          revokedSessionsCount,
          newDeviceName: input.newDeviceName,
        })
      ),
    });

    return {
      newSessionToken: rawToken,
      revokedSessionsCount,
      verifiedArtifact,
    };
  }
}

export { AuthenticationError, AuthorizationError, ValidationError };