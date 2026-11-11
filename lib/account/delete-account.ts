// lib/account/delete-account.ts
// Self-serve account deletion. The owner proves it is them twice, on the server:
//   1. a one-time code that Neon Auth emailed to THEIR account address. The server checks it
//      against the email in the signed-in session, never against anything the browser sends, so a
//      code issued to someone else's address (or for another purpose) is refused;
//   2. typing their account email.
// Then, in ONE database transaction:
//   - the Dusk user row is deleted, and every table that belongs to the user goes with it through
//     the foreign keys (vault, folders, items, files, people, release assignments, check-in plan,
//     workflow and release events, recovery data, message records, activity records);
//   - the Neon Auth identity (sign-in account, every session, pending codes) is deleted from the
//     neon_auth schema, which Neon Auth keeps in our own database.
// All or nothing: if either part fails the transaction rolls back and nothing is deleted.
//
// What is kept on purpose: the PaymentEvent ledger (no foreign key to User, so it is untouched).
//
// Why SQL for the identity: the managed Neon Auth service does not offer self-serve user deletion
// (POST /delete-user answers 404 on this project), and the admin removal endpoint needs an admin
// session. The app's own database role owns the neon_auth schema, and Neon Auth reads sessions and
// accounts straight from those tables, so removing the row ends every sign-in at once. This was
// checked against the dev branch: old cookie no longer a session, old password refused, and the
// same email registers again as a brand new account. See docs/LAUNCH_RUNBOOK_AND_SECURITY_REVIEW.md.
import { Prisma, type PrismaClient, type ScheduleState } from "@prisma/client";
import { z } from "zod";
import { ValidationError } from "../auth/errors";
import { checkOtp, normalizeEmail } from "../auth/one-time-code";
import { ACCOUNT_DELETE_OTP_TYPE } from "./otp-type";

/**
 * The kind of emailed code used. "email-verification" is separate from the "forget-password" code,
 * so a password-reset code can never delete an account and the other way round. Neon Auth is set up
 * for emailed codes (email_verification_method = otp).
 */
export { ACCOUNT_DELETE_OTP_TYPE };

export const DeleteAccountInputSchema = z
  .object({
    confirmEmail: z.string().trim().min(3, "Type your account email to confirm.").max(254),
    code: z.string().min(1, "Enter the 6-digit code from your email.").max(32),
    acknowledgeReleaseImpact: z.boolean().optional(),
  })
  .strict();
export type DeleteAccountInput = z.infer<typeof DeleteAccountInputSchema>;

export function parseDeleteAccountInput(raw: unknown): DeleteAccountInput {
  const parsed = DeleteAccountInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? "Check the details and try again.");
  }
  return parsed.data;
}

/** What deleting would do to a release, in the words the screen needs. */
export type ReleaseImpact = "NONE" | "IN_PROGRESS" | "RELEASED";

const IN_PROGRESS_STATES: ReadonlySet<ScheduleState> = new Set<ScheduleState>([
  "ESCALATION_PENDING",
  "VERIFICATION_REQUIRED",
  "RELEASE_HOLD",
]);

export function releaseImpactFor(state: ScheduleState | null | undefined): ReleaseImpact {
  if (!state) return "NONE";
  if (state === "RELEASED") return "RELEASED";
  return IN_PROGRESS_STATES.has(state) ? "IN_PROGRESS" : "NONE";
}

export function emailsMatch(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

export type DeleteAccountErrorCode =
  | "EMAIL_MISMATCH"
  | "ACKNOWLEDGEMENT_REQUIRED"
  | "CODE_INVALID"
  | "CODE_TOO_MANY_ATTEMPTS"
  | "CODE_CHECK_RATE_LIMITED"
  | "CODE_CHECK_UNAVAILABLE"
  | "DELETION_FAILED";

const ERROR_STATUS: Record<DeleteAccountErrorCode, number> = {
  EMAIL_MISMATCH: 400,
  ACKNOWLEDGEMENT_REQUIRED: 409,
  CODE_INVALID: 400,
  CODE_TOO_MANY_ATTEMPTS: 403,
  CODE_CHECK_RATE_LIMITED: 429,
  CODE_CHECK_UNAVAILABLE: 503,
  DELETION_FAILED: 500,
};

const ERROR_MESSAGE: Record<DeleteAccountErrorCode, string> = {
  EMAIL_MISMATCH: "That isn't the email on your account. Type it exactly as shown above.",
  ACKNOWLEDGEMENT_REQUIRED: "Please tick the box to confirm you understand what happens to your plan.",
  CODE_INVALID: "That code isn't right, or it has expired. Check the latest email, or ask for a new code.",
  CODE_TOO_MANY_ATTEMPTS: "Too many wrong codes. Ask for a new code and try again.",
  CODE_CHECK_RATE_LIMITED: "Too many tries. Wait a minute, then try again.",
  CODE_CHECK_UNAVAILABLE: "We couldn't check your code right now. Nothing was deleted. Try again in a minute.",
  DELETION_FAILED: "We couldn't finish deleting your account, so nothing was deleted. Try again in a minute.",
};

/** A refusal the person can fix. `status` is the HTTP status the route answers with. */
export class AccountDeletionError extends Error {
  readonly status: number;
  constructor(public readonly code: DeleteAccountErrorCode) {
    super(ERROR_MESSAGE[code]);
    this.name = "AccountDeletionError";
    this.status = ERROR_STATUS[code];
  }
}

export type OtpVerdict =
  | { ok: true }
  | { ok: false; reason: "INVALID" | "TOO_MANY_ATTEMPTS" | "RATE_LIMITED" | "UNAVAILABLE" };

/** Checks an emailed code for an address without using it up. The real one asks Neon Auth. */
export interface OtpChecker {
  check(args: { email: string; otp: string }): Promise<OtpVerdict>;
}

/** The slice of the Neon Auth server SDK this needs, so tests can stand in for it. */
export interface NeonOtpServer {
  emailOtp: {
    checkVerificationOtp(args: {
      email: string;
      type: typeof ACCOUNT_DELETE_OTP_TYPE;
      otp: string;
    }): Promise<{ data?: unknown; error?: { status?: number; code?: string } | null }>;
  };
}

/**
 * The SDK types `emailOtp` as unknown on the server object, so check at run time that the method is
 * really there instead of casting blindly. A missing method fails every check closed.
 */
export function asNeonOtpServer(server: unknown): NeonOtpServer {
  const emailOtp = (server as { emailOtp?: { checkVerificationOtp?: unknown } } | null)?.emailOtp;
  const check = emailOtp?.checkVerificationOtp;
  return {
    emailOtp: {
      checkVerificationOtp: async (args) => {
        if (typeof check !== "function") throw new Error("Neon Auth email code check is not available.");
        return (await check.call(emailOtp, args)) as Awaited<ReturnType<NeonOtpServer["emailOtp"]["checkVerificationOtp"]>>;
      },
    },
  };
}

/**
 * Asks Neon Auth whether `otp` is the live code it emailed to `email`. Only an explicit
 * `{ success: true }` counts; every other answer, and any thrown error, is a refusal.
 */
export function createNeonOtpChecker(server: NeonOtpServer): OtpChecker {
  return {
    async check({ email, otp }) {
      let result: Awaited<ReturnType<NeonOtpServer["emailOtp"]["checkVerificationOtp"]>>;
      try {
        result = await server.emailOtp.checkVerificationOtp({ email, type: ACCOUNT_DELETE_OTP_TYPE, otp });
      } catch {
        return { ok: false, reason: "UNAVAILABLE" };
      }
      if (!result.error) {
        const data = result.data as { success?: unknown } | null | undefined;
        return data?.success === true ? { ok: true } : { ok: false, reason: "INVALID" };
      }
      const { status, code } = result.error;
      if (code === "TOO_MANY_ATTEMPTS") return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
      if (status === 429) return { ok: false, reason: "RATE_LIMITED" };
      if (code === "INVALID_OTP" || code === "OTP_EXPIRED" || status === 400) return { ok: false, reason: "INVALID" };
      return { ok: false, reason: "UNAVAILABLE" };
    },
  };
}

type Tx = Pick<PrismaClient, "$executeRaw"> & { user: Pick<PrismaClient["user"], "findUnique" | "deleteMany"> };

const UUID = z.string().uuid();

/** The three kinds of emailed code Better Auth keeps per address, as stored in neon_auth.verification. */
export function otpIdentifiersFor(email: string): string[] {
  const e = normalizeEmail(email);
  return [`email-verification-otp-${e}`, `forget-password-otp-${e}`, `sign-in-otp-${e}`];
}

export interface DeletionTarget {
  /** The Dusk user id, resolved on the server from the signed-in session. */
  userId: string;
  /** The Neon Auth user id of that same session. */
  authUserId: string;
  email: string;
}

export interface DeletionOutcome {
  /** False when the Dusk account was already gone (a repeated or simultaneous request). */
  duskUserDeleted: boolean;
  identityDeleted: boolean;
}

/**
 * Deletes one person's data and sign-in. Must run inside a transaction so it is all or nothing.
 * Touches only the rows of `target`: the Dusk user by its id, the Neon Auth user by its id, and
 * that address's own pending codes.
 */
export async function deleteAccountRows(tx: Tx, target: DeletionTarget): Promise<DeletionOutcome> {
  const authUserId = UUID.parse(target.authUserId);

  // The Dusk account and the sign-in must belong together. A mismatch is a bug or an attack, and
  // rolls the whole transaction back. (An account that is already gone is fine: a repeated request.)
  const existing = await tx.user.findUnique({ where: { id: target.userId }, select: { authUserId: true } });
  if (existing && existing.authUserId !== authUserId) {
    throw new Error("The account and the sign-in identity do not belong together.");
  }

  const removed = await tx.user.deleteMany({ where: { id: target.userId } });

  const identifiers = otpIdentifiersFor(target.email);
  await tx.$executeRaw`
    DELETE FROM neon_auth.verification WHERE "identifier" IN (${Prisma.join(identifiers)})`;
  // Sessions, accounts, memberships and invitations of this user go with it (ON DELETE CASCADE).
  const identity = await tx.$executeRaw`
    DELETE FROM neon_auth."user" WHERE "id" = ${authUserId}::uuid`;

  return { duskUserDeleted: removed.count > 0, identityDeleted: identity > 0 };
}

export interface DeleteAccountDeps {
  db: PrismaClient;
  otp: OtpChecker;
}

export interface DeleteAccountRequest {
  /** From the verified session. Never from the request body. */
  session: { authUserId: string; email: string };
  userId: string;
  input: DeleteAccountInput;
}

/** What the screen needs before the person starts: how the release stands. */
export async function describeReleaseImpact(db: Pick<PrismaClient, "checkInSchedule">, userId: string): Promise<ReleaseImpact> {
  const schedule = await db.checkInSchedule.findUnique({ where: { userId }, select: { state: true } });
  return releaseImpactFor(schedule?.state);
}

/**
 * The whole deletion: confirmation, release warning, server-side code check, then the transaction.
 * Cheap checks come first so a typo never spends one of the code's three tries.
 */
export async function deleteOwnAccount(deps: DeleteAccountDeps, request: DeleteAccountRequest): Promise<DeletionOutcome> {
  const { session, userId, input } = request;

  if (!emailsMatch(input.confirmEmail, session.email)) throw new AccountDeletionError("EMAIL_MISMATCH");

  const impact = await describeReleaseImpact(deps.db, userId);
  if (impact !== "NONE" && input.acknowledgeReleaseImpact !== true) {
    throw new AccountDeletionError("ACKNOWLEDGEMENT_REQUIRED");
  }

  const code = checkOtp(input.code);
  if (!code.ok) throw new AccountDeletionError("CODE_INVALID");

  const verdict = await deps.otp.check({ email: normalizeEmail(session.email), otp: code.code });
  if (!verdict.ok) {
    throw new AccountDeletionError(
      verdict.reason === "INVALID"
        ? "CODE_INVALID"
        : verdict.reason === "TOO_MANY_ATTEMPTS"
          ? "CODE_TOO_MANY_ATTEMPTS"
          : verdict.reason === "RATE_LIMITED"
            ? "CODE_CHECK_RATE_LIMITED"
            : "CODE_CHECK_UNAVAILABLE"
    );
  }

  try {
    return await deps.db.$transaction(
      (tx) => deleteAccountRows(tx, { userId, authUserId: session.authUserId, email: session.email }),
      { maxWait: 5_000, timeout: 30_000 }
    );
  } catch (err) {
    // Nothing was deleted (the transaction rolled back). Log the kind of failure, never row data.
    console.error("[account-delete] transaction failed", { error: err instanceof Error ? err.name : "UnknownError" });
    throw new AccountDeletionError("DELETION_FAILED");
  }
}
