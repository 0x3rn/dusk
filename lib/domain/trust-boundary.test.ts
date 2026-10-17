import { describe, expect, it } from "vitest";
import {
  EncryptedEnvelopeSchema,
  TrustBoundaryViolationError,
  assertZeroKnowledgePayload,
  evaluateFailClosedReleasePolicy,
  redactForAuditLog,
  type ReleaseEvaluationContext,
} from "./trust-boundary";

describe("THE-96: Zero-Knowledge Trust Boundary & Fail-Closed Rules", () => {
  describe("EncryptedEnvelopeSchema validation", () => {
    const validIv = Buffer.alloc(12, 1).toString("base64");
    const validCiphertext = Buffer.alloc(32, 2).toString("base64");

    it("accepts a well-formed AES-256-GCM encrypted envelope", () => {
      const result = EncryptedEnvelopeSchema.safeParse({
        schemaVersion: 1,
        algorithm: "AES-256-GCM",
        keyVersion: 1,
        ivBase64: validIv,
        ciphertextBase64: validCiphertext,
        aadContext: {
          vaultId: "vault_123",
          resourceId: "item_456",
          resourceType: "VAULT_ITEM",
          keyVersion: 1,
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects an IV that is not exactly 12 bytes (96 bits)", () => {
      const shortIv = Buffer.alloc(8, 1).toString("base64");
      const result = EncryptedEnvelopeSchema.safeParse({
        schemaVersion: 1,
        algorithm: "AES-256-GCM",
        keyVersion: 1,
        ivBase64: shortIv,
        ciphertextBase64: validCiphertext,
        aadContext: {
          vaultId: "vault_123",
          resourceId: "item_456",
          resourceType: "VAULT_ITEM",
          keyVersion: 1,
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects ciphertext shorter than 17 bytes (missing 16-byte GCM auth tag)", () => {
      const truncatedCiphertext = Buffer.alloc(16, 2).toString("base64");
      const result = EncryptedEnvelopeSchema.safeParse({
        schemaVersion: 1,
        algorithm: "AES-256-GCM",
        keyVersion: 1,
        ivBase64: validIv,
        ciphertextBase64: truncatedCiphertext,
        aadContext: {
          vaultId: "vault_123",
          resourceId: "item_456",
          resourceType: "VAULT_ITEM",
          keyVersion: 1,
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe("assertZeroKnowledgePayload boundary guard", () => {
    it("allows safe encrypted envelopes and operational metadata", () => {
      expect(() =>
        assertZeroKnowledgePayload({
          vaultId: "vault_123",
          keyVersion: 1,
          ivBase64: "AAAAAAAAAAAAAAAA",
          ciphertextBase64: "BBBBBBBBBBBBBBBBBBBBBBBB",
          wrappedKeyBase64: "CCCCCCCCCCCCCCCCCCCCCCCC",
        })
      ).not.toThrow();
    });

    it("rejects payloads containing plaintext secret fields or raw keys at any nesting depth", () => {
      expect(() =>
        assertZeroKnowledgePayload({
          title: "My Ledger",
          secretData: "abandon ability able...",
        })
      ).toThrowError(TrustBoundaryViolationError);

      expect(() =>
        assertZeroKnowledgePayload({
          nested: {
            items: [{ vault_key: "raw-base64-key" }],
          },
        })
      ).toThrowError(/nested\.items\[0\]\.vault_key/);

      expect(() =>
        assertZeroKnowledgePayload({
          recoveryPassphrase: "correct horse battery staple",
        })
      ).toThrowError(TrustBoundaryViolationError);
    });
  });

  describe("redactForAuditLog", () => {
    it("redacts passwords, tokens, ciphertexts, and secret keys while preserving operational IDs", () => {
      const rawEvent = {
        userId: "user_1",
        action: "VAULT_ITEM_CREATED",
        sessionToken: "tok_secret_123",
        ciphertextBase64: "sensitive_blob",
        nested: {
          seedPhrase: "my twelve words",
          beneficiaryId: "ben_99",
        },
      };

      const redacted = redactForAuditLog(rawEvent);
      expect(redacted).toEqual({
        userId: "user_1",
        action: "VAULT_ITEM_CREATED",
        sessionToken: "[REDACTED]",
        ciphertextBase64: "[REDACTED]",
        nested: {
          seedPhrase: "[REDACTED]",
          beneficiaryId: "ben_99",
        },
      });
    });
  });

  describe("evaluateFailClosedReleasePolicy", () => {
    const baseValidContext: ReleaseEvaluationContext = {
      currentScheduleState: "VERIFICATION_REQUIRED",
      missedCheckInDueAtMs: 1_000_000,
      nowMs: 1_000_000 + 14 * 24 * 60 * 60 * 1000, // 14 days later
      configuredGracePeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days grace
      remindersSentCount: 3,
      minRequiredReminders: 3,
      hasConfirmedReminderDelivery: true,
      userCanceledOrCheckedInAfterDue: false,
      trustedContactSignaledAlive: false,
      hasActiveReleaseHold: false,
      requiredVerifierApprovals: 1,
      actualVerifierApprovals: 1,
    };

    it("permits release ONLY when all staged verification, grace period, delivery, and verifier conditions are met", () => {
      const decision = evaluateFailClosedReleasePolicy(baseValidContext);
      expect(decision.allowRelease).toBe(true);
      expect(decision.failClosedReasons).toEqual([]);
    });

    it("fails closed if only a single reminder was configured or sent (missed email != proof of death)", () => {
      const decision = evaluateFailClosedReleasePolicy({
        ...baseValidContext,
        remindersSentCount: 1,
        minRequiredReminders: 1,
      });
      expect(decision.allowRelease).toBe(false);
      expect(decision.failClosedReasons).toContain("SINGLE_REMINDER_POLICY_FORBIDDEN");
    });

    it("fails closed when email/SMS provider had an outage (no confirmed delivery)", () => {
      const decision = evaluateFailClosedReleasePolicy({
        ...baseValidContext,
        hasConfirmedReminderDelivery: false,
      });
      expect(decision.allowRelease).toBe(false);
      expect(decision.failClosedReasons).toContain(
        "NO_CONFIRMED_NOTIFICATION_DELIVERY_PROVIDER_OUTAGE_PROTECTION"
      );
    });

    it("fails closed if a trusted contact signaled the user is alive", () => {
      const decision = evaluateFailClosedReleasePolicy({
        ...baseValidContext,
        trustedContactSignaledAlive: true,
      });
      expect(decision.allowRelease).toBe(false);
      expect(decision.failClosedReasons).toContain("TRUSTED_CONTACT_SIGNALED_USER_ALIVE");
    });

    it("fails closed if grace period has not fully elapsed", () => {
      const decision = evaluateFailClosedReleasePolicy({
        ...baseValidContext,
        nowMs: baseValidContext.missedCheckInDueAtMs + 1000,
      });
      expect(decision.allowRelease).toBe(false);
      expect(decision.failClosedReasons).toContain("GRACE_PERIOD_NOT_YET_ELAPSED");
    });

    it("fails closed if an active release hold is present or user checked in", () => {
      const decision = evaluateFailClosedReleasePolicy({
        ...baseValidContext,
        hasActiveReleaseHold: true,
        userCanceledOrCheckedInAfterDue: true,
      });
      expect(decision.allowRelease).toBe(false);
      expect(decision.failClosedReasons).toContain("ACTIVE_RELEASE_HOLD");
      expect(decision.failClosedReasons).toContain(
        "USER_CHECKED_IN_OR_CANCELED_FALSE_TRIGGER"
      );
    });
  });
});