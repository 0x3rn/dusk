// lib/auth/client-errors.ts
// Turns whatever the Neon Auth browser SDK throws or returns into one safe, readable message.

const FRIENDLY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Try signing in.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account with this email already exists. Try signing in.",
  EMAIL_NOT_VERIFIED: "Please verify your email address first.",
  INVALID_OTP: "That code isn't right. Check it and try again.",
  OTP_EXPIRED: "That code has expired. Request a new one.",
  TOO_MANY_ATTEMPTS: "Too many attempts. Wait a moment and try again.",
  PASSWORD_TOO_SHORT: "That password is too short.",
};

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

  return pickString(body.message) ?? pickString(e.message) ?? fallback;
}
