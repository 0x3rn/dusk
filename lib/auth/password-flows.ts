// lib/auth/password-flows.ts
// The three steps of "forgot password" and "change password", kept out of the React components so
// they can be tested without a browser. Every function returns a plain result and never throws, and
// no function logs, stores or returns the one-time code or the password.

import { authErrorMessage } from "./client-errors";
import { checkOtp, looksLikeEmail, normalizeEmail } from "./one-time-code";
import { checkNewPasswordPair } from "./password-policy";

/** A Better Auth call resolves to `{ data, error }` rather than throwing on a server error. */
type CallResult = { error?: unknown } | null | undefined;

/** The small part of the Neon Auth browser client these flows use. `authClient` satisfies it. */
export interface PasswordAuthClient {
  emailOtp: {
    sendVerificationOtp(args: { email: string; type: "forget-password" }): Promise<CallResult>;
    resetPassword(args: { email: string; otp: string; password: string }): Promise<CallResult>;
  };
  signIn: {
    email(args: { email: string; password: string }): Promise<CallResult>;
  };
  getSession(): Promise<{ data?: unknown; error?: unknown } | null | undefined>;
  revokeOtherSessions(): Promise<CallResult>;
}

export type FlowResult = { ok: true } | { ok: false; message: string };

/** Shown whether or not an account uses the email, so the page never reveals who has an account. */
export const NEUTRAL_CODE_SENT_MESSAGE =
  "If an account uses that email, we've sent a 6-digit code. It can take a minute to arrive.";

const SEND_FALLBACK = "We couldn't send a code right now. Check your connection and try again in a minute.";
const RESET_FALLBACK = "We couldn't change your password. Check your connection and try again.";

function failed(result: CallResult): result is { error: unknown } {
  return Boolean(result && result.error);
}

/**
 * Step 1: ask for a code. The server answers "success" for emails with no account, so a success here
 * means "if there is an account, a code is on its way", and the caller must show the neutral message.
 * Only real failures (bad format, rate limit, no connection) are surfaced.
 */
export async function requestResetCode(client: PasswordAuthClient, rawEmail: string): Promise<FlowResult> {
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) {
    return { ok: false, message: "Enter the email address you signed up with." };
  }
  try {
    const result = await client.emailOtp.sendVerificationOtp({ email, type: "forget-password" });
    if (failed(result)) return { ok: false, message: authErrorMessage(result.error, SEND_FALLBACK) };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, message: authErrorMessage(err, SEND_FALLBACK) };
  }
}

export interface ResetInput {
  email: string;
  code: string;
  password: string;
  confirm: string;
}

/** Step 2: check everything locally first, so a typo costs no attempt on the 3-try code. */
export async function resetPasswordWithCode(client: PasswordAuthClient, input: ResetInput): Promise<FlowResult> {
  const otp = checkOtp(input.code);
  if (!otp.ok) return { ok: false, message: otp.message };
  const pair = checkNewPasswordPair(input.password, input.confirm);
  if (!pair.ok) return { ok: false, message: pair.message };

  try {
    const result = await client.emailOtp.resetPassword({
      email: normalizeEmail(input.email),
      otp: otp.code,
      password: input.password,
    });
    if (failed(result)) return { ok: false, message: authErrorMessage(result.error, RESET_FALLBACK) };
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, message: authErrorMessage(err, RESET_FALLBACK) };
  }
}

export type ChangePasswordResult =
  | {
      ok: true;
      /** True when the other devices are signed out. False means that last step failed. */
      otherSessionsEnded: boolean;
      /** True when this browser lost its session and could not get a new one, so the person must sign in. */
      needsSignIn: boolean;
    }
  | { ok: false; message: string };

/**
 * Change password for someone who is signed in. The emailed code is the proof it is really them,
 * so the same code-based reset endpoint is used. If the server ends every session on reset (this
 * project turns that on), this browser is signed straight back in with the new password, then every
 * OTHER session is ended explicitly so the result is the same whichever way the server is configured.
 */
export async function changePasswordWithCode(
  client: PasswordAuthClient,
  input: ResetInput
): Promise<ChangePasswordResult> {
  const reset = await resetPasswordWithCode(client, input);
  if (!reset.ok) return reset;

  const email = normalizeEmail(input.email);
  let hasSession = false;
  try {
    const session = await client.getSession();
    hasSession = Boolean(session && session.data);
  } catch {
    hasSession = false;
  }

  if (!hasSession) {
    try {
      const signIn = await client.signIn.email({ email, password: input.password });
      if (failed(signIn)) return { ok: true, otherSessionsEnded: true, needsSignIn: true };
    } catch {
      return { ok: true, otherSessionsEnded: true, needsSignIn: true };
    }
  }

  try {
    const revoked = await client.revokeOtherSessions();
    if (failed(revoked)) return { ok: true, otherSessionsEnded: false, needsSignIn: false };
  } catch {
    return { ok: true, otherSessionsEnded: false, needsSignIn: false };
  }
  return { ok: true, otherSessionsEnded: true, needsSignIn: false };
}
