// lib/auth/password-policy.ts
// One shared rule for new account passwords (sign-up, reset and change). Pure, so it runs the same
// in the browser (instant feedback) and in tests. The sign-in server enforces its own limits too;
// this is never the only line of defence.

export const MIN_PASSWORD_LENGTH = 10;
/** Matches the Neon Auth server cap (counted in UTF-16 units), so we refuse it before sending. */
export const MAX_PASSWORD_LENGTH = 128;

export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters.`;

export type PasswordIssue = "empty" | "only_spaces" | "too_short" | "too_long" | "mismatch";

export type PasswordCheck = { ok: true } | { ok: false; issue: PasswordIssue; message: string };

const MESSAGES: Record<PasswordIssue, string> = {
  empty: "Enter a new password.",
  only_spaces: "A password can't be only spaces.",
  too_short: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  too_long: `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`,
  mismatch: "The two passwords don't match.",
};

function fail(issue: PasswordIssue): PasswordCheck {
  return { ok: false, issue, message: MESSAGES[issue] };
}

/**
 * Length is counted in visible characters (code points), so an emoji counts once. The upper cap is
 * counted in UTF-16 units because that is how the server counts, which keeps us strictly inside its limit.
 * Spaces are allowed inside a password and the password is never trimmed.
 */
export function checkNewPassword(password: string): PasswordCheck {
  if (password.length === 0) return fail("empty");
  if (password.trim().length === 0) return fail("only_spaces");
  // Long input is rejected before counting code points, so a huge paste costs nothing.
  if (password.length > MAX_PASSWORD_LENGTH) return fail("too_long");
  if (Array.from(password).length < MIN_PASSWORD_LENGTH) return fail("too_short");
  return { ok: true };
}

/** The new password plus its confirmation box. Checks the password first, then that both match. */
export function checkNewPasswordPair(password: string, confirm: string): PasswordCheck {
  const single = checkNewPassword(password);
  if (!single.ok) return single;
  if (password !== confirm) return fail("mismatch");
  return { ok: true };
}
