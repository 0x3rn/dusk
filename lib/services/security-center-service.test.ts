// lib/services/security-center-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  SecurityCenterService,
  type SecurityCenterPersistencePort,
} from "./security-center-service";
import { AuthorizationError, hashIpAddress } from "../auth/security";
import type { SessionRecord, UserRecord } from "./foundation-service";
import type { RecoveryArtifactRecord } from "./recovery-service";

class InMemorySecurityCenterStore implements SecurityCenterPersistencePort {
  public user: (UserRecord & { mfaEnabled: boolean }) | null = null;
  public sessions = new Map<string, SessionRecord>();
  public recoveryArtifacts: RecoveryArtifactRecord[] = [];
  public verifiedBeneficiariesCount = 1;
  public verifiedVerifiersCount = 1;
  public scheduleState = { state: "HEALTHY", remindersSentCount: 0 };
  public audits: Array<{
    id: string;
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
    createdAt: Date;
  }> = [];

  async findUserById(userId: string) {
    return this.user?.id === userId ? this.user : null;
  }

  async updateUserMfaState(
    userId: string,
    data: { mfaEnabled: boolean; mfaSecretEncrypted: string | null }
  ) {
    if (this.user && this.user.id === userId) {
      this.user = { ...this.user, mfaEnabled: data.mfaEnabled };
    }
  }

  async listSessionsByUserId(userId: string): Promise<SessionRecord[]> {
    return Array.from(this.sessions.values()).filter(
      (s) => s.userId === userId
    );
  }

  async findSessionById(sessionId: string): Promise<SessionRecord | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async revokeSessionById(
    sessionId: string,
    revokedAt: Date
  ): Promise<SessionRecord> {
    const existing = this.sessions.get(sessionId)!;
    const updated = { ...existing, revokedAt };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  async revokeAllOtherSessions(
    userId: string,
    keepSessionId: string,
    revokedAt: Date
  ): Promise<number> {
    let count = 0;
    for (const [id, s] of this.sessions.entries()) {
      if (s.userId === userId && id !== keepSessionId && s.revokedAt === null) {
        this.sessions.set(id, { ...s, revokedAt });
        count++;
      }
    }
    return count;
  }

  async listActiveRecoveryArtifacts() {
    return this.recoveryArtifacts;
  }

  async countVerifiedBeneficiaries() {
    return this.verifiedBeneficiariesCount;
  }

  async countVerifiedTrustedVerifiers() {
    return this.verifiedVerifiersCount;
  }

  async getScheduleState() {
    return this.scheduleState;
  }

  async listRecentAuditEvents(userId: string, limit: number) {
    return this.audits.filter((a) => a.userId === userId).slice(0, limit);
  }

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: "INFO" | "WARN" | "CRITICAL";
    redactedMeta: string;
  }) {
    this.audits.unshift({
      id: `aud_${crypto.randomUUID()}`,
      ...data,
      createdAt: new Date(),
    });
  }
}

describe("THE-109: Security Center, Device Management & Suspicious-Access Protections", () => {
  let store: InMemorySecurityCenterStore;
  let service: SecurityCenterService;
  const userId = "usr_sec_owner";
  const now = new Date("2026-10-18T12:00:00Z");

  beforeEach(() => {
    store = new InMemorySecurityCenterStore();
    store.user = {
      id: userId,
      email: "owner@dusk.app",
      fullName: "Security Owner",
      passwordHash: "hash",
      firebaseUid: null,
      authProvider: "PASSWORD",
      hasLifetimeAccess: true,
      mfaEnabled: false,
      createdAt: now,
    };

    store.sessions.set("ses_current", {
      id: "ses_current",
      userId,
      tokenHash: "tok_1",
      deviceName: "MacBook Pro (Chrome)",
      userAgent: "Mozilla/5.0 Macintosh",
      ipAddressHash: hashIpAddress("198.51.100.10"),
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
      revokedAt: null,
    });

    store.sessions.set("ses_tablet", {
      id: "ses_tablet",
      userId,
      tokenHash: "tok_2",
      deviceName: "iPad Pro (Safari)",
      userAgent: "Mozilla/5.0 iPad",
      ipAddressHash: hashIpAddress("198.51.100.10"),
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
      revokedAt: null,
    });

    store.sessions.set("ses_phone", {
      id: "ses_phone",
      userId,
      tokenHash: "tok_3",
      deviceName: "iPhone 16 (Safari)",
      userAgent: "Mozilla/5.0 iPhone",
      ipAddressHash: hashIpAddress("198.51.100.10"),
      lastActiveAt: now,
      expiresAt: new Date(now.getTime() + 86400000),
      revokedAt: null,
    });

    store.recoveryArtifacts = [
      {
        id: "rec_1",
        userId,
        keyVersion: 1,
        recoveryWrappedVmKBase64: "wrapped",
        recoveryWrappedVmKIv: "iv",
        kdfSaltBase64: "salt",
        kdfAlgorithm: "PBKDF2",
        fingerprintHex: "1122334455667788",
        isActive: true,
        revokedAt: null,
        lastVerifiedAt: now,
        createdAt: now,
      },
    ];

    service = new SecurityCenterService(store);
  });

  it("1. lists active devices, revokes single or all other sessions, and blocks cross-user session revocation", async () => {
    const overviewBefore = await service.getSecurityCenterOverview(
      userId,
      "ses_current",
      now
    );
    expect(overviewBefore.activeSessions).toHaveLength(3);

    // Cross-user revocation attempt blocked
    await expect(
      service.revokeDeviceSession("usr_attacker_999", "ses_tablet", now)
    ).rejects.toThrowError(AuthorizationError);

    // Revoke single session (ses_tablet)
    await service.revokeDeviceSession(userId, "ses_tablet", now);
    const afterSingleRevoke = await service.getSecurityCenterOverview(
      userId,
      "ses_current",
      now
    );
    expect(afterSingleRevoke.activeSessions).toHaveLength(2);

    // Revoke all other sessions except ses_current
    const bulk = await service.revokeAllOtherDeviceSessions(
      userId,
      "ses_current",
      now
    );
    expect(bulk.revokedCount).toBe(1);

    const afterBulkRevoke = await service.getSecurityCenterOverview(
      userId,
      "ses_current",
      now
    );
    expect(afterBulkRevoke.activeSessions).toHaveLength(1);
    expect(afterBulkRevoke.activeSessions[0].sessionId).toBe("ses_current");
    expect(afterBulkRevoke.activeSessions[0].isCurrentSession).toBe(true);
  });

  it("2. enables MFA and computes a 100% 5-pillar security posture without decrypting vault contents", async () => {
    // Before MFA is enabled, score is 80% (4 of 5 pillars SECURE)
    const beforeMfa = await service.getSecurityCenterOverview(
      userId,
      "ses_current",
      now
    );
    expect(beforeMfa.mfaEnabled).toBe(false);
    expect(beforeMfa.securityScorePercent).toBe(80);

    // Enable MFA
    await service.updateMfaConfiguration(userId, {
      enable: true,
      encryptedMfaSecretOrPasskeyCredential:
        "encrypted_totp_or_webauthn_credential_blob",
    });

    const afterMfa = await service.getSecurityCenterOverview(
      userId,
      "ses_current",
      now
    );
    expect(afterMfa.mfaEnabled).toBe(true);
    expect(afterMfa.securityScorePercent).toBe(100);
    expect(afterMfa.recoveryState.activeFingerprintHex).toBe("1122334455667788");
  });

  it("3. detects suspicious access from new IP/device, rapid failed logins, and failed release attempts", async () => {
    // Known IP + known User-Agent -> LOW risk
    const normalEval = await service.inspectAndRecordAccessRisk({
      userId,
      ipAddress: "198.51.100.10",
      userAgent: "Mozilla/5.0 Macintosh",
      actionName: "VAULT_VIEW",
    });
    expect(normalEval.riskLevel).toBe("LOW");
    expect(normalEval.signals).toEqual([]);

    // Seed 3 failed logins + 2 denied release package attempts
    for (let i = 0; i < 3; i++) {
      await store.appendAuditEvent({
        userId,
        eventType: "AUTH_LOGIN_FAILED",
        severity: "WARN",
        redactedMeta: "{}",
      });
    }
    for (let i = 0; i < 2; i++) {
      await store.appendAuditEvent({
        userId,
        eventType: "BENEFICIARY_PACKAGE_ACCESS_DENIED",
        severity: "WARN",
        redactedMeta: "{}",
      });
    }

    // Attempt a sensitive operation (e.g., key rotation) from an unseen IP and unseen User-Agent
    const highRiskEval = await service.inspectAndRecordAccessRisk({
      userId,
      ipAddress: "203.0.113.250",
      userAgent: "Linux x86_64 UnknownBot",
      actionName: "RECOVERY_KIT_ROTATION",
      isSensitiveOperation: true,
    });

    expect(highRiskEval.riskLevel).toBe("HIGH");
    expect(highRiskEval.requiresStepUpVerification).toBe(true);
    expect(highRiskEval.signals).toContain("NEW_IP_ADDRESS_HASH");
    expect(highRiskEval.signals).toContain("NEW_DEVICE_USER_AGENT");
    expect(highRiskEval.signals).toContain("RAPID_FAILED_LOGIN_ATTEMPTS");
    expect(highRiskEval.signals).toContain("REPEATED_FAILED_RELEASE_ATTEMPTS");
    expect(highRiskEval.signals).toContain("SENSITIVE_ACTION_FROM_NEW_DEVICE");

    // Confirm SECURITY_SUSPICIOUS_ACCESS_DETECTED was logged
    expect(store.audits[0].eventType).toBe(
      "SECURITY_SUSPICIOUS_ACCESS_DETECTED"
    );
    expect(store.audits[0].severity).toBe("CRITICAL");
  });
});