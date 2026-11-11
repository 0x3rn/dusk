// lib/auth/client-errors.ts
// Turns whatever the Neon Auth browser SDK throws or returns into one safe, readable message.

const FRIENDLY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Try signing in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Try signing in.",
  EMAIL_NOT_VERIFIED: "Please verify your email address first.",
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many wrong codes. Request a new code to try again.",
  PASSWORD_TOO_SHORT: "That password is too short. Use at least 10 characters.",
  PASSWORD_TOO_LONG: "That password is too long. Use 128 characters or fewer.",
  INVALID_EMAIL: "That email address doesn't look right.",
  // After a correct code the account must exist, so this is not worth explaining to the visitor.
  USER_NOT_FOUND: "We couldn't reset that password. Request a new code and try again.",
  INVALID_TOKEN: "That code isn't valid any more. Request a new one.",
  RATE_LIMITED: "Too many requests. Wait a minute and try again.",
  TOO_MANY_REQUESTS: "Too many requests. Wait a minute and try again.",
  SESSION_EXPIRED: "Your session has ended. Sign in again and retry.",
  FAILED_TO_GET_SESSION: "Your session has ended. Sign in again and retry.",
  UNAUTHORIZED: "Your session has ended. Sign in again and retry.",
};

const RATE_LIMIT_MESSAGE = "Too many requests. Wait a minute and try again.";

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

/**
 * Accepts a thrown AuthHttpError, a `{ error }` result, or anything else, and returns a message
 * that is safe to show a user. Never returns stack traces or raw objects.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  if (typeof err !== "object" || err === null) return fallback;
  const e = err as Record<string, unknown>;

  const body =
    typeof e.error === "object" && e.error !== null ? (e.error as Record<string, unknown>) : e;

  const code = pickString(body.code) ?? pickString(e.code);
  if (code && FRIENDLY[code]) return FRIENDLY[code];

  // Rate limits often arrive with only an HTTP status, no code.
  if (body.status === 429 || e.status === 429) return RATE_LIMIT_MESSAGE;

  return pickString(body.message) ?? pickString(e.message) ?? fallback;
}
