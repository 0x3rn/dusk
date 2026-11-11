// lib/api/dashboard-actions.ts
// Every action POST /api/dashboard accepts, as one schema. The route used to read fields straight
// off the parsed body, so a missing field crashed with a 500 and any value (objects, megabytes of
// text) reached the database. Parsing here gives each action exact types and length caps.
import { z } from "zod";
import { ValidationError } from "../auth/security";
import { assertZeroKnowledgePayload } from "../domain/trust-boundary";
import { isAcceptableKdfAlgorithm } from "../crypto/kdf";

const id = z.string().min(1).max(64);
const base64 = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/, "Must be standard Base64.");
const reason = z.string().trim().max(240);

// Encrypted envelopes are checked field by field by FoundationService; here we only require an object.
const envelope = z.record(z.string(), z.unknown());

const ContactSchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name is required.").max(120),
    email: z
      .string()
      .trim()
      .max(254)
      .pipe(z.email("Enter a valid email address."))
      .transform((e) => e.toLowerCase()),
    phone: z.union([z.literal("").transform(() => null), z.string().trim().min(7).max(30), z.null()]).optional(),
    isBeneficiary: z.boolean(),
    isTrustedVerifier: z.boolean(),
    publicKeyBase64: base64(200).nullish(),
  })
  .refine((c) => c.isBeneficiary || c.isTrustedVerifier, {
    message: "A contact must be designated as a Beneficiary, a Trusted Verifier, or both.",
  })
  .refine((c) => !c.isBeneficiary || Boolean(c.publicKeyBase64), {
    message: "A beneficiary needs a public key so items can be wrapped for them.",
    path: ["publicKeyBase64"],
  });

const AssignmentSchema = z.object({
  contactId: id,
  itemId: id,
  beneficiaryWrappedKeyBase64: base64(2_000),
  beneficiaryWrappedKeyIv: base64(100),
  ephemeralPublicKeyBase64: base64(400),
  keyVersion: z.number().int().positive().max(10_000),
});

const RecoveryArtifactSchema = z.object({
  keyVersion: z.number().int().positive().max(10_000),
  recoveryWrappedVmKBase64: base64(2_000),
  recoveryWrappedVmKIv: base64(100),
  kdfSaltBase64: base64(200),
  kdfAlgorithm: z
    .string()
    .min(1)
    .max(100)
    .refine((id) => isAcceptableKdfAlgorithm(id, "recovery-kit"), "Unsupported key settings."),
  fingerprintHex: z.string().regex(/^[0-9a-fA-F]{8,128}$/),
});

export const DashboardActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("LOGOUT") }),
  z.object({
    action: z.literal("INIT_VAULT"),
    vaultBundle: envelope,
    recoveryServerArtifact: RecoveryArtifactSchema.nullish(),
  }),
  z.object({ action: z.literal("ADD_ENCRYPTED_ITEM"), item: envelope }),
  z.object({ action: z.literal("DELETE_ENCRYPTED_ITEM"), itemId: id }),
  z.object({ action: z.literal("ADD_CONTACT"), contact: ContactSchema }),
  z.object({ action: z.literal("REVOKE_CONTACT"), contactId: id }),
  z.object({ action: z.literal("RESEND_INVITE"), contactId: id }),
  z.object({ action: z.literal("CANCEL_INVITE"), contactId: id }),
  z.object({ action: z.literal("ASSIGN_ITEM_TO_BENEFICIARY"), assignment: AssignmentSchema }),
  z.object({ action: z.literal("UNASSIGN_ITEM_FROM_BENEFICIARY"), contactId: id, itemId: id }),
  z.object({ action: z.literal("CHECK_IN_NOW"), idempotencyKey: z.string().max(200).optional() }),
  z.object({
    action: z.literal("UPDATE_SCHEDULE_CONFIG"),
    intervalDays: z.number().int().optional(),
    gracePeriodDays: z.number().int().optional(),
  }),
  z.object({
    action: z.literal("PAUSE_SCHEDULE"),
    pauseDays: z.number().int().optional(),
    reason: reason.optional(),
  }),
  z.object({ action: z.literal("CANCEL_FALSE_TRIGGER"), reason: reason.optional() }),
]);

export type DashboardAction = z.infer<typeof DashboardActionSchema>;

/** Validates an untrusted dashboard request body. Throws ValidationError / TrustBoundaryViolationError. */
export function parseDashboardAction(raw: unknown): DashboardAction {
  // Refuse plaintext secrets and raw keys anywhere in the body, whatever the action.
  assertZeroKnowledgePayload(raw);
  const parsed = DashboardActionSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new ValidationError(
      issue?.code === "invalid_union" || issue?.path[0] === "action"
        ? "Unknown action."
        : `${issue?.message ?? "Invalid request."}${where}`
    );
  }
  return parsed.data;
}
