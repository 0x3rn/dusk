// lib/account/delete-account-client.ts
// The browser side of account deletion, kept out of the React card so it can be tested without a
// browser. Functions return plain results and never throw. Nothing here logs or stores the code.
import { authErrorMessage } from "../auth/client-errors";
import { checkOtp, normalizeEmail } from "../auth/one-time-code";
import { ACCOUNT_DELETE_OTP_TYPE } from "./otp-type";
import type { ReleaseImpact } from "./delete-account";

type CallResult = { error?: unknown } | null | undefined;

/** The part of the Neon Auth browser client used to email the code. `authClient` satisfies it. */
export interface DeletionAuthClient {
  emailOtp: {
    sendVerificationOtp(args: { email: string; type: typeof ACCOUNT_DELETE_OTP_TYPE }): Promise<CallResult>;
  };
}

export type SendCodeResult = { ok: true } | { ok: false; message: string };

const SEND_FALLBACK = "We couldn't send a code right now. Check your connection and try again in a minute.";

/** Emails a 6-digit code to the signed-in person's own address. */
export async function requestDeletionCode(client: DeletionAuthClient, accountEmail: string): Promise<SendCodeResult> {
  try {
    const result = await client.emailOtp.sendVerificationOtp({
      email: normalizeEmail(accountEmail),
      type: ACCOUNT_DELETE_OTP_TYPE,
    });
    if (result && result.error) return { ok: false, message: authErrorMessage(result.error, SEND_FALLBACK) };
    return { ok: true };
  } catch (err: unknown) {
    // Only an error from the sign-in service (it carries a code or status) has a message worth
    // showing. Anything else is a network or script error whose text means nothing to the reader.
    const fromService = typeof err === "object" && err !== null && ("code" in err || "status" in err);
    return { ok: false, message: fromService ? authErrorMessage(err, SEND_FALLBACK) : SEND_FALLBACK };
  }
}

/** What the card knows about the release. UNKNOWN (lookup failed) is treated like a release that is under way. */
export type DisplayedImpact = ReleaseImpact | "UNKNOWN";

export function impactNeedsAcknowledgement(impact: DisplayedImpact): boolean {
  return impact !== "NONE";
}

export interface DeletionFormValues {
  accountEmail: string;
  confirmEmail: string;
  code: string;
  impact: DisplayedImpact;
  acknowledged: boolean;
}

export interface DeletionFormErrors {
  code?: string;
  confirmEmail?: string;
  acknowledged?: string;
}

/** Local checks, so an obvious slip costs no request. The server repeats every one of them. */
export function checkDeletionForm(values: DeletionFormValues): { ok: true; code: string } | { ok: false; errors: DeletionFormErrors } {
  const errors: DeletionFormErrors = {};
  const otp = checkOtp(values.code);
  if (!otp.ok) errors.code = otp.message;
  if (normalizeEmail(values.confirmEmail) !== normalizeEmail(values.accountEmail)) {
    errors.confirmEmail = "That isn't the email on your account. Type it exactly as shown above.";
  }
  if (impactNeedsAcknowledgement(values.impact) && !values.acknowledged) {
    errors.acknowledged = "Please tick the box to confirm you understand.";
  }
  if (errors.code || errors.confirmEmail || errors.acknowledged) return { ok: false, errors };
  return { ok: true, code: otp.ok ? otp.code : "" };
}

export type SubmitResult = { ok: true } | { ok: false; message: string; code?: string };

export type PostFn = (url: string, init: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;

const SUBMIT_FALLBACK = "We couldn't delete your account, so nothing was deleted. Check your connection and try again.";

export async function submitAccountDeletion(
  post: PostFn,
  body: { confirmEmail: string; code: string; acknowledgeReleaseImpact: boolean }
): Promise<SubmitResult> {
  try {
    const res = await post("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const data = (await res.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
    const message = typeof data?.error === "string" && data.error.length > 0 ? data.error : SUBMIT_FALLBACK;
    return { ok: false, message, code: typeof data?.code === "string" ? data.code : undefined };
  } catch {
    return { ok: false, message: SUBMIT_FALLBACK };
  }
}

/** Reads how a release stands. Any failure becomes UNKNOWN, which asks for the extra confirmation. */
export async function loadReleaseImpact(
  get: (url: string) => Promise<Pick<Response, "ok" | "json">>
): Promise<DisplayedImpact> {
  try {
    const res = await get("/api/account/delete");
    if (!res.ok) return "UNKNOWN";
    const data = (await res.json()) as { releaseImpact?: unknown };
    return data.releaseImpact === "NONE" || data.releaseImpact === "IN_PROGRESS" || data.releaseImpact === "RELEASED"
      ? data.releaseImpact
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
