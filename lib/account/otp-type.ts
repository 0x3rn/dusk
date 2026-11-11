// lib/account/otp-type.ts
// Shared by the server and the browser. Kept free of server imports so the Settings card can use it.

/**
 * The kind of emailed code used to delete an account. "email-verification" is separate from the
 * "forget-password" code, so a password-reset code can never delete an account and the other way
 * round. Neon Auth is configured for emailed codes (email_verification_method = otp).
 */
export const ACCOUNT_DELETE_OTP_TYPE = "email-verification" as const;
