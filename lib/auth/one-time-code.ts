// lib/auth/one-time-code.ts
// The 6-digit code we email for password resets. This file only cleans and checks what the person
// typed; it never creates, stores or logs a code.

export const OTP_LENGTH = 6;

/** People paste codes as "123 456" or "123-456". Keep digits only. */
export function normalizeOtp(raw: string): string {
  return raw.replace(/\D/g, "");
}

export type OtpCheck = { ok: true; code: string } | { ok: false; message: string };

export function checkOtp(raw: string): OtpCheck {
  const code = normalizeOtp(raw);
  if (code.length === 0) return { ok: false, message: "Enter the 6-digit code from your email." };
  if (code.length !== OTP_LENGTH) {
    return { ok: false, message: `The code has ${OTP_LENGTH} digits. Check your email and try again.` };
  }
  return { ok: true, code };
}

/** Lower-cased and trimmed, matching how the server stores emails. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately simple: the browser and the server do the strict check. This only catches typos
// like a missing "@" before we spend a request.
export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
