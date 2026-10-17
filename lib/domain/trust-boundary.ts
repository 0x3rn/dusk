import { z } from "zod";

/**
 * THE-96: Zero-Knowledge Trust Boundary & Fail-Closed Release Rules
 *
 * This module codifies the invariants defined in docs/THREAT_MODEL.md:
 * 1. The server must never accept, persist, or log plaintext vault secrets or raw cryptographic keys.
 * 2. All encrypted envelopes persisted by the server must carry explicit version, IV/nonce, ciphertext, and wrapped key metadata.
 * 3. Uncertain, incomplete, or contradicted release states must fail closed (never transition to RELEASED).
 */

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

export function isValidBase64(value: string, minBytes = 1): boolean {
  if (!value || value.length % 4 !== 0 || !BASE64_REGEX.test(value)) {
    return false;
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const byteLength = (value.length * 3) / 4 - padding;
  return byteLength >= minBytes;
}

/**
 * Schema for an encrypted payload envelope allowed to cross the client -> server boundary.
 * AES-GCM requires a 12-byte (96-bit) IV and produces ciphertext + 16-byte (128-bit) authentication tag.
 */
export const EncryptedEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal("AES-256-GCM"),
  keyVersion: z.number().int().positive(),
  ivBase64: z
    .string()
    .refine((val) => isValidBase64(val, 12) && isValidBase64(val, 12) && Buffer.from(val, "base64").byteLength === 12, {
      message: "IV must be exactly 12 bytes (96 bits) encoded as Base64",
    }),
  ciphertextBase64: z
    .string()
    .refine((val) => isValidBase64(val, 17), {
      message: "Ciphertext must be valid Base64 containing at least 1 byte of payload + 16-byte GCM auth tag",
    }),
  aadContext: z.object({
    vaultId: z.string().min(1),
    resourceId: z.string().min(1),
    resourceType: z.enum(["VAULT_ITEM", "VAULT_FILE", "RECOVERY_KIT", "RELEASE_PACKAGE"]),
    keyVersion: z.number().int().positive(),
  }),
});

export type EncryptedEnvelope = z.infer<typeof EncryptedEnvelopeSchema>;

/**
 * Forbidden field names that must NEVER appear in server-persisted vault payloads,
 * API request bodies for vault items, or operational audit/event logs.
 */
const FORBIDDEN_PLAINTEXT_KEYS = new Set([
  "plaintext",
  "secretdata",
  "seedphrase",
  "mnemonic",
  "privatekey",
  "masterkey",
  "vaultkey",
  "rawkey",
  "unwrappedkey",
  "recoverysecret",
  "recoverypassphrase",
  "decrypted",
  "passwordplaintext",
  "secretcontent",
]);

export class TrustBoundaryViolationError extends Error {
  public readonly code = "TRUST_BOUNDARY_VIOLATION";
  public readonly violatingField: string;

  constructor(message: string, violatingField: string) {
    super(message);
    this.name = "TrustBoundaryViolationError";
    this.violatingField = violatingField;
  }
}

/**
 * Recursively inspects an untrusted payload crossing into the server or audit logger.
 * Throws TrustBoundaryViolationError if any forbidden plaintext or raw key field is present.
 */
export function assertZeroKnowledgePayload(
  payload: unknown,
  path = "root"
): void {
  if (payload === null || payload === undefined) {
    return;
  }

  if (Array.isArray(payload)) {
    payload.forEach((item, idx) => assertZeroKnowledgePayload(item, `${path}[${idx}]`));
    return;
  }

  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      const currentPath = `${path}.${key}`;

      if (FORBIDDEN_PLAINTEXT_KEYS.has(normalizedKey)) {
        throw new TrustBoundaryViolationError(
          `Zero-knowledge boundary violation: forbidden field "${currentPath}" cannot be sent to or stored by the server.`,
          currentPath
        );
      }

      assertZeroKnowledgePayload(value, currentPath);
    }
  }
}

/**
 * Redacts sensitive fields from an arbitrary object before operational or audit logging.
 * Ensures secrets, tokens, passwords, and raw keys are never written to logs.
 */
const REDACTED_LOG_KEYS = new Set([
  ...FORBIDDEN_PLAINTEXT_KEYS,
  "password",
  "passwordhash",
  "token",
  "idtoken",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "authorization",
  "cookie",
  "stripesignature",
  "ciphertext",
  "ciphertextbase64",
  "wrappedkey",
  "wrappedkeybase64",
]);

export function redactForAuditLog(
  input: Record<string, unknown>
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    const normalized = key.toLowerCase().replace(/[_-]/g, "");
    if (REDACTED_LOG_KEYS.has(normalized)) {
      clean[key] = "[REDACTED]";
    } else if (Array.isArray(value)) {
      clean[key] = value.map((item) =>
        typeof item === "object" && item !== null
          ? redactForAuditLog(item as Record<string, unknown>)
          : item
      );
    } else if (typeof value === "object" && value !== null) {
      clean[key] = redactForAuditLog(value as Record<string, unknown>);
    } else {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * THE-96 Fail-Closed Release Policy Evaluation
 *
 * A single missed reminder or timer expiration is NEVER sufficient to release a vault.
 * If any required stage is incomplete, or if any hold/alive-signal/cancellation is present,
 * the decision MUST fail closed (`allowRelease: false`).
 */
export interface ReleaseEvaluationContext {
  currentScheduleState:
    | "HEALTHY"
    | "REMINDER_DUE"
    | "GRACE_PERIOD"
    | "ESCALATION_PENDING"
    | "VERIFICATION_REQUIRED"
    | "RELEASE_HOLD"
    | "PAUSED"
    | "CANCELED"
    | "RELEASED";
  missedCheckInDueAtMs: number;
  nowMs: number;
  configuredGracePeriodMs: number;
  remindersSentCount: number;
  minRequiredReminders: number;
  hasConfirmedReminderDelivery: boolean;
  userCanceledOrCheckedInAfterDue: boolean;
  trustedContactSignaledAlive: boolean;
  hasActiveReleaseHold: boolean;
  requiredVerifierApprovals: number;
  actualVerifierApprovals: number;
}

export interface ReleaseEvaluationDecision {
  allowRelease: boolean;
  failClosedReasons: string[];
}

export function evaluateFailClosedReleasePolicy(
  ctx: ReleaseEvaluationContext
): ReleaseEvaluationDecision {
  const reasons: string[] = [];

  if (ctx.userCanceledOrCheckedInAfterDue) {
    reasons.push("USER_CHECKED_IN_OR_CANCELED_FALSE_TRIGGER");
  }

  if (ctx.trustedContactSignaledAlive) {
    reasons.push("TRUSTED_CONTACT_SIGNALED_USER_ALIVE");
  }

  if (ctx.hasActiveReleaseHold || ctx.currentScheduleState === "RELEASE_HOLD") {
    reasons.push("ACTIVE_RELEASE_HOLD");
  }

  if (ctx.currentScheduleState === "PAUSED") {
    reasons.push("SCHEDULE_IS_PAUSED");
  }

  if (ctx.currentScheduleState === "CANCELED") {
    reasons.push("WORKFLOW_WAS_CANCELED");
  }

  if (ctx.currentScheduleState !== "VERIFICATION_REQUIRED") {
    reasons.push(
      `INVALID_STATE_FOR_RELEASE:${ctx.currentScheduleState}_MUST_BE_VERIFICATION_REQUIRED`
    );
  }

  if (ctx.configuredGracePeriodMs <= 0) {
    reasons.push("INVALID_ZERO_OR_NEGATIVE_GRACE_PERIOD");
  }

  const elapsedSinceDueMs = ctx.nowMs - ctx.missedCheckInDueAtMs;
  if (elapsedSinceDueMs < ctx.configuredGracePeriodMs) {
    reasons.push("GRACE_PERIOD_NOT_YET_ELAPSED");
  }

  if (ctx.minRequiredReminders < 2) {
    reasons.push("SINGLE_REMINDER_POLICY_FORBIDDEN");
  }

  if (ctx.remindersSentCount < ctx.minRequiredReminders) {
    reasons.push("INSUFFICIENT_REMINDERS_SENT");
  }

  if (!ctx.hasConfirmedReminderDelivery) {
    reasons.push("NO_CONFIRMED_NOTIFICATION_DELIVERY_PROVIDER_OUTAGE_PROTECTION");
  }

  if (ctx.actualVerifierApprovals < ctx.requiredVerifierApprovals) {
    reasons.push("VERIFIER_APPROVAL_THRESHOLD_NOT_MET");
  }

  return {
    allowRelease: reasons.length === 0,
    failClosedReasons: reasons,
  };
}