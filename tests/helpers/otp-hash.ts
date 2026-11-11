// tests/helpers/otp-hash.ts
// Pure helpers for reading a stored reset code. Kept apart from the database helper so they can be unit tested.
import { createHash } from "node:crypto";

/** Better Auth stores the code as `<value>:<wrong attempts>` under `forget-password-otp-<email>`. */
export function resetOtpIdentifier(email: string): string {
  return `forget-password-otp-${email.trim().toLowerCase()}`;
}

/** The stored identifier of any kind of emailed code ("forget-password", "email-verification", "sign-in"). */
export function otpIdentifier(type: "forget-password" | "email-verification" | "sign-in", email: string): string {
  return `${type}-otp-${email.trim().toLowerCase()}`;
}

/**
 * Neon Auth stores the code hashed: `base64url(sha256(code)):<wrong attempts>`. A 6-digit code only has
 * a million possibilities, so this finds the one that matches (about a second). Plain 6-digit values are
 * accepted too in case the project's storage setting changes. This is for the dev database only.
 */
export function parseStoredOtp(stored: string): string {
  const idx = stored.lastIndexOf(":");
  const value = idx === -1 ? stored : stored.slice(0, idx);
  if (/^\d{6}$/.test(value)) return value;
  for (let n = 0; n < 1_000_000; n++) {
    const code = n.toString().padStart(6, "0");
    if (createHash("sha256").update(code).digest("base64url") === value) return code;
  }
  throw new Error("The stored reset code is neither a plain 6-digit value nor a SHA-256 hash of one.");
}
