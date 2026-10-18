// lib/services/security-center-service.ts
import { z } from "zod";
import {
  AuthenticationError,
  ValidationError,
  assertResourceOwnership,
  hashIpAddress,
} from "../auth/security";
import { redactForAuditLog } from "../domain/trust-boundary";
import type { SessionRecord, UserRecord } from "./foundation-service";
import type { RecoveryArtifactRecord } from "./recovery-service";

/**
 * THE-109: Security Center, Device Management & Suspicious-Access Protections
 *
 * Invariants:
 * 1. Revoked sessions immediately lose access (`revokedAt !== null`).
 * 2. Suspicious sign-ins, recovery attempts, and failed release attempts are detected
 *    from practical risk signals and surfaced as high-visibility security events.
 * 3. The Security Center operates strictly on account/session/audit metadata and
 *    NEVER requires decrypting vault contents.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RiskSignalCode =
  | "NEW_IP_ADDRESS_HASH"
  | "NEW_DEVICE_USER_AGENT"
  | "RAPID_FAILED_LOGIN_ATTEMPTS"
  | "REPEATED_FAILED_RELEASE_ATTEMPTS"
  | "SENSITIVE_ACTION_FROM_NEW_DEVICE";

export interface RiskEvaluationResult {
  riskLevel: RiskLevel;
  riskScore: number;
  signals: RiskSignalCode[];
  requiresStepUpVerification: boolean;
}

export interface ActiveDeviceSessionView {
  sessionId: string;
  deviceName: string;
  userAgent: string | null;
  ipAddressHash: string | null;
  lastActiveAtIso: string;
  expiresAtIso: string;
  isCurrentSession: boolean;
}

export interface SecurityChecklistPillar {
  pillarId:
    | "AUTHENTICATION_AND_MFA"
    | "RECOVERY_KIT_POSTURE"
    | "DEVICE_SESSION_HYGIENE"
    | "BENEFICIARY_AND_VERIFIER_SETUP"
    | "CHECKIN_AND_RELEASE_HEALTH";
  title: string;
  status: "SECURE" | "ATTENTION" | "AT_RISK";
  detail: string;
}

export interface SecurityCenterOverview {
  securityScorePercent: number;
  mfaEnabled: boolean;
  authProvider: UserRecord["authProvider"];
  recoveryState: {
    hasActiveRecoveryKit: boolean;
    activeFingerprintHex: string | null;
    keyVersion: number | null;
    lastVerifiedAtIso: string | null;
  };
  activeSessions: ActiveDeviceSessionView[];
  recentSecurityEvents: Array<{
    id: string;
    eventType: string;
    severity: string;
    createdAtIso: string;
    redactedMeta: Record<string, unknown>;
  }>;
  checklist: SecurityChecklistPillar[];
}

export interface SecurityCenterPersistencePort {
  findUserById(
    userId: string
  ): Promise<
    | (UserRecord & {
        mfaEnabled: boolean;
      })
    | null
  >;
  updateUserMfaState(
    userId: string,
    data: { mfaEnabled: boolean; mfaSecretEncrypted: string | null }
  ): Promise<void>;
  listSessionsByUserId(userId: string): Promise<SessionRecord[]>;
  findSessionById(sessionId: string): Promise<SessionRecord | null>;
  revokeSessionById(sessionId: string, revokedAt: Date): Promise<SessionRecord>;
  revokeAllOtherSessions(
    userId: string,
    keepSessionId: string,
    revokedAt: Date
  ): Promise<number>;
  listActiveRecoveryArtifacts(userId: string): Promise<RecoveryArtifactRecord[]>;
  countVerifiedBeneficiaries(userId: string): Promise<number>;
  countVerifiedTrustedVerifiers(userId: string): Promise<number>;
  getScheduleState(
    userId: string
  ): Promise<{ state: string; remindersSentCount: number } | null>;
  listRecentAuditEvents(
    userId: string,
    limit: number
  ): Promise<
    Array<{
      id: string;
      userId: string;
      eventType: string;
      severity: string;
      redactedMeta: string;
      createdAt: Date;
    }>
  >;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    redactedMeta: string;
  }): Promise<void>;
}

const SECURITY_RELEVANT_EVENT_TYPES = new Set([
  "ACCOUNT_REGISTERED_PASSWORD",
  "AUTH_LOGIN_FAILED",
  "AUTH_GOOGLE_SYNC",
  "SESSION_REVOKED",
  "ALL_OTHER_SESSIONS_REVOKED",
  "MFA_ENABLED",
  "MFA_DISABLED",
  "RECOVERY_KIT_CREATED",
  "RECOVERY_KIT_ROTATED",
  "RECOVERY_KIT_REVOKED",
  "RECOVERY_RE_ENROLLMENT_COMPLETED",
  "CONTACT_SAVED",
  "CONTACT_REVOKED",
  "CONTACT_REPLACED",
  "BENEFICIARY_ITEM_ASSIGNED",
  "BENEFICIARY_ITEM_UNASSIGNED",
  "FALSE_TRIGGER_CANCELED",
  "TRUSTED_CONTACT_SIGNALED_ALIVE",
  "RELEASE_HOLD_PLACED",
  "ESTATE_RELEASE_AUTHORIZED",
  "BENEFICIARY_PACKAGE_ACCESS_DENIED",
  "BENEFICIARY_PACKAGE_DELIVERED",
  "SECURITY_SUSPICIOUS_ACCESS_DETECTED",
]);

/**
 * Pure risk-evaluation engine (`THE-109`):
 * Evaluates practical risk signals from known sessions and recent security events.
 */
export function evaluateAccessRiskSignals(params: {
  ipAddress?: string | null;
  userAgent?: string | null;
  isSensitiveOperation?: boolean;
  knownSessions: SessionRecord[];
  recentAuditEventTypes: string[];
}): RiskEvaluationResult {
  const signals: RiskSignalCode[] = [];
  let riskScore = 0;

  const ipHash = params.ipAddress ? hashIpAddress(params.ipAddress) : null;

  if (params.knownSessions.length > 0) {
    if (ipHash) {
      const seenIp = params.knownSessions.some(
        (s) => s.ipAddressHash === ipHash && s.revokedAt === null
      );
      if (!seenIp) {
        signals.push("NEW_IP_ADDRESS_HASH");
        riskScore += 30;
      }
    }

    if (params.userAgent) {
      const seenUa = params.knownSessions.some(
        (s) => s.userAgent === params.userAgent && s.revokedAt === null
      );
      if (!seenUa) {
        signals.push("NEW_DEVICE_USER_AGENT");
        riskScore += 25;
      }
    }
  }

  const recentFailedLogins = params.recentAuditEventTypes.filter(
    (t) => t === "AUTH_LOGIN_FAILED"
  ).length;
  if (recentFailedLogins >= 3) {
    signals.push("RAPID_FAILED_LOGIN_ATTEMPTS");
    riskScore += 40;
  }

  const recentFailedReleases = params.recentAuditEventTypes.filter(
    (t) => t === "BENEFICIARY_PACKAGE_ACCESS_DENIED"
  ).length;
  if (recentFailedReleases >= 2) {
    signals.push("REPEATED_FAILED_RELEASE_ATTEMPTS");
    riskScore += 45;
  }

  if (
    params.isSensitiveOperation &&
    (signals.includes("NEW_IP_ADDRESS_HASH") ||
      signals.includes("NEW_DEVICE_USER_AGENT"))
  ) {
    signals.push("SENSITIVE_ACTION_FROM_NEW_DEVICE");
    riskScore += 35;
  }

  const riskLevel: RiskLevel =
    riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW";

  return {
    riskLevel,
    riskScore: Math.min(100, riskScore),
    signals,
    requiresStepUpVerification: riskLevel === "HIGH",
  };
}

export const ConfigureMfaInputSchema = z.object({
  enable: z.boolean(),
  encryptedMfaSecretOrPasskeyCredential: z.string().min(16).optional(),
});

export class SecurityCenterService {
  constructor(private readonly store: SecurityCenterPersistencePort) {}

  /**
   * Builds the complete Security Center posture, active device list,
   * recent security events, and 5-pillar security checklist without decrypting vault contents.
   */
  async getSecurityCenterOverview(
    authenticatedUserId: string | null | undefined,
    currentSessionId: string,
    now = new Date()
  ): Promise<SecurityCenterOverview> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const user = await this.store.findUserById(authenticatedUserId);
    if (!user) {
      throw new AuthenticationError("User not found.");
    }

    const [
      allSessions,
      recoveryArtifacts,
      verifiedBeneficiariesCount,
      verifiedVerifiersCount,
      scheduleState,
      rawAudits,
    ] = await Promise.all([
      this.store.listSessionsByUserId(authenticatedUserId),
      this.store.listActiveRecoveryArtifacts(authenticatedUserId),
      this.store.countVerifiedBeneficiaries(authenticatedUserId),
      this.store.countVerifiedTrustedVerifiers(authenticatedUserId),
      this.store.getScheduleState(authenticatedUserId),
      this.store.listRecentAuditEvents(authenticatedUserId, 50),
    ]);

    const activeSessions: ActiveDeviceSessionView[] = allSessions
      .filter(
        (s) => s.revokedAt === null && s.expiresAt.getTime() > now.getTime()
      )
      .map((s) => ({
        sessionId: s.id,
        deviceName: s.deviceName ?? "Unknown Device",
        userAgent: s.userAgent,
        ipAddressHash: s.ipAddressHash,
        lastActiveAtIso: s.lastActiveAt.toISOString(),
        expiresAtIso: s.expiresAt.toISOString(),
        isCurrentSession: s.id === currentSessionId,
      }));

    const activeKit = recoveryArtifacts[0] ?? null;

    const recentSecurityEvents = rawAudits
      .filter((ev) => SECURITY_RELEVANT_EVENT_TYPES.has(ev.eventType))
      .slice(0, 20)
      .map((ev) => {
        let parsedMeta: Record<string, unknown> = {};
        try {
          parsedMeta = redactForAuditLog(JSON.parse(ev.redactedMeta));
        } catch {
          parsedMeta = {};
        }
        return {
          id: ev.id,
          eventType: ev.eventType,
          severity: ev.severity,
          createdAtIso: ev.createdAt.toISOString(),
          redactedMeta: parsedMeta,
        };
      });

    const hasRecentSuspiciousOrFailedRelease = recentSecurityEvents.some(
      (e) =>
        e.eventType === "SECURITY_SUSPICIOUS_ACCESS_DETECTED" ||
        e.eventType === "BENEFICIARY_PACKAGE_ACCESS_DENIED"
    );

    const checklist: SecurityChecklistPillar[] = [
      {
        pillarId: "AUTHENTICATION_AND_MFA",
        title: "Authentication & Multi-Factor Protection",
        status: user.mfaEnabled ? "SECURE" : "ATTENTION",
        detail: user.mfaEnabled
          ? `MFA/Passkey protection enabled (${user.authProvider} auth).`
          : `Primary ${user.authProvider} authentication active. Enable MFA/Passkey for stronger session protection.`,
      },
      {
        pillarId: "RECOVERY_KIT_POSTURE",
        title: "Offline Recovery Kit Readiness",
        status: activeKit ? "SECURE" : "AT_RISK",
        detail: activeKit
          ? `Active Recovery Kit enrolled (fingerprint: ${activeKit.fingerprintHex}, kv:${activeKit.keyVersion}).`
          : "No active offline Recovery Kit found. Generate one immediately to prevent permanent lockout.",
      },
      {
        pillarId: "DEVICE_SESSION_HYGIENE",
        title: "Active Device & Session Hygiene",
        status:
          activeSessions.length <= 5 && !hasRecentSuspiciousOrFailedRelease
            ? "SECURE"
            : "ATTENTION",
        detail: `${activeSessions.length} active device session(s). Revoke any unrecognized devices.`,
      },
      {
        pillarId: "BENEFICIARY_AND_VERIFIER_SETUP",
        title: "Beneficiary & Trusted Verifier Separation",
        status:
          verifiedBeneficiariesCount >= 1 && verifiedVerifiersCount >= 1
            ? "SECURE"
            : "ATTENTION",
        detail: `${verifiedBeneficiariesCount} verified Beneficiary(s) and ${verifiedVerifiersCount} verified Trusted Verifier(s) configured.`,
      },
      {
        pillarId: "CHECKIN_AND_RELEASE_HEALTH",
        title: "Check-In Schedule & Release Safety",
        status:
          scheduleState?.state === "HEALTHY" ||
          scheduleState?.state === "PAUSED"
            ? "SECURE"
            : "AT_RISK",
        detail: scheduleState
          ? `Dead-Man's Switch is ${scheduleState.state} (${scheduleState.remindersSentCount} missed-check-in reminders sent).`
          : "Check-in schedule not initialized.",
      },
    ];

    const secureCount = checklist.filter((c) => c.status === "SECURE").length;
    const securityScorePercent = Math.round(
      (secureCount / checklist.length) * 100
    );

    return {
      securityScorePercent,
      mfaEnabled: user.mfaEnabled,
      authProvider: user.authProvider,
      recoveryState: {
        hasActiveRecoveryKit: Boolean(activeKit),
        activeFingerprintHex: activeKit?.fingerprintHex ?? null,
        keyVersion: activeKit?.keyVersion ?? null,
        lastVerifiedAtIso: activeKit?.lastVerifiedAt?.toISOString() ?? null,
      },
      activeSessions,
      recentSecurityEvents,
      checklist,
    };
  }

  /**
   * Revokes a specific device session owned by the user.
   */
  async revokeDeviceSession(
    authenticatedUserId: string | null | undefined,
    targetSessionId: string,
    now = new Date()
  ): Promise<SessionRecord> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const session = assertResourceOwnership(
      await this.store.findSessionById(targetSessionId),
      authenticatedUserId,
      "Session"
    );

    const revoked = await this.store.revokeSessionById(session.id, now);

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "SESSION_REVOKED",
      severity: "WARN",
      redactedMeta: JSON.stringify({
        revokedSessionId: session.id,
        deviceName: session.deviceName,
      }),
    });

    return revoked;
  }

  /**
   * Revokes all active sessions except the caller's current session (`keepSessionId`).
   */
  async revokeAllOtherDeviceSessions(
    authenticatedUserId: string | null | undefined,
    keepSessionId: string,
    now = new Date()
  ): Promise<{ revokedCount: number }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const revokedCount = await this.store.revokeAllOtherSessions(
      authenticatedUserId,
      keepSessionId,
      now
    );

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "ALL_OTHER_SESSIONS_REVOKED",
      severity: "CRITICAL",
      redactedMeta: JSON.stringify({
        keptSessionId: keepSessionId,
        revokedCount,
      }),
    });

    return { revokedCount };
  }

  /**
   * Enables or disables MFA/Passkey state on the user's account and logs a security event.
   */
  async updateMfaConfiguration(
    authenticatedUserId: string | null | undefined,
    rawInput: unknown
  ): Promise<{ mfaEnabled: boolean }> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const parsed = ConfigureMfaInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new ValidationError("Invalid MFA configuration parameters.");
    }
    const input = parsed.data;

    if (input.enable && !input.encryptedMfaSecretOrPasskeyCredential) {
      throw new ValidationError(
        "Encrypted MFA secret or passkey credential is required to enable MFA."
      );
    }

    await this.store.updateUserMfaState(authenticatedUserId, {
      mfaEnabled: input.enable,
      mfaSecretEncrypted: input.enable
        ? (input.encryptedMfaSecretOrPasskeyCredential ?? null)
        : null,
    });

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: input.enable ? "MFA_ENABLED" : "MFA_DISABLED",
      severity: input.enable ? "INFO" : "CRITICAL",
      redactedMeta: JSON.stringify({
        mfaEnabled: input.enable,
      }),
    });

    return { mfaEnabled: input.enable };
  }

  /**
   * Evaluates sign-in or sensitive-action risk signals and logs a
   * `SECURITY_SUSPICIOUS_ACCESS_DETECTED` event whenever risk is MEDIUM or HIGH.
   */
  async inspectAndRecordAccessRisk(params: {
    userId: string;
    ipAddress?: string | null;
    userAgent?: string | null;
    actionName: string;
    isSensitiveOperation?: boolean;
  }): Promise<RiskEvaluationResult> {
    const [knownSessions, recentAudits] = await Promise.all([
      this.store.listSessionsByUserId(params.userId),
      this.store.listRecentAuditEvents(params.userId, 25),
    ]);

    const evaluation = evaluateAccessRiskSignals({
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      isSensitiveOperation: params.isSensitiveOperation,
      knownSessions,
      recentAuditEventTypes: recentAudits.map((a) => a.eventType),
    });

    if (evaluation.riskLevel !== "LOW") {
      await this.store.appendAuditEvent({
        userId: params.userId,
        eventType: "SECURITY_SUSPICIOUS_ACCESS_DETECTED",
        severity: evaluation.riskLevel === "HIGH" ? "CRITICAL" : "WARN",
        redactedMeta: JSON.stringify(
          redactForAuditLog({
            actionName: params.actionName,
            riskLevel: evaluation.riskLevel,
            riskScore: evaluation.riskScore,
            signals: evaluation.signals,
          })
        ),
      });
    }

    return evaluation;
  }
}