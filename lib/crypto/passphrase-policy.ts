// lib/crypto/passphrase-policy.ts
// Rules for choosing a NEW vault master passphrase. Pure, with no browser or Node imports, so the
// same check runs in the form (instant feedback) and in the crypto layer (the real guard).
//
// This applies to new passphrases only. Unlocking never checks length: a vault made when the
// minimum was 8 characters must keep opening with the passphrase it was made with.

/** Minimum length for a new vault master passphrase (was 8 before Argon2id was introduced). */
export const MIN_NEW_PASSPHRASE_LENGTH = 12;

/** Upper bound so an absurd paste cannot stall key derivation. */
export const MAX_PASSPHRASE_LENGTH = 1024;

export const PASSPHRASE_HINT =
  "At least 12 characters. A short sentence you will remember works well, for example four unrelated words.";

export type PassphraseProblem = "empty" | "too-short" | "too-long" | "mismatch";

/** Counts what a person sees as characters (an emoji or accented letter counts once). */
export function passphraseLength(passphrase: string): number {
  return Array.from(passphrase.normalize("NFKC")).length;
}

/** Plain-language messages for the form. */
export const PASSPHRASE_PROBLEM_MESSAGES: Record<PassphraseProblem, string> = {
  empty: "Type a master passphrase.",
  "too-short": `Your passphrase needs at least ${MIN_NEW_PASSPHRASE_LENGTH} characters. Add a few more words or letters.`,
  "too-long": `Your passphrase is too long. Keep it under ${MAX_PASSPHRASE_LENGTH} characters.`,
  mismatch: "The two passphrases don't match. Type the same one in both boxes.",
};

/**
 * Returns the first problem with a new passphrase (and optional confirmation), or null when it
 * is acceptable. Surrounding spaces are not trimmed: they are part of the passphrase.
 */
export function findNewPassphraseProblem(passphrase: string, confirmation?: string): PassphraseProblem | null {
  if (passphrase.length === 0) return "empty";
  const length = passphraseLength(passphrase);
  if (length < MIN_NEW_PASSPHRASE_LENGTH) return "too-short";
  if (length > MAX_PASSPHRASE_LENGTH) return "too-long";
  if (confirmation !== undefined && confirmation !== passphrase) return "mismatch";
  return null;
}

export class WeakPassphraseError extends Error {
  public readonly code = "PASSPHRASE_REJECTED";
  public readonly problem: PassphraseProblem;
  constructor(problem: PassphraseProblem) {
    super(PASSPHRASE_PROBLEM_MESSAGES[problem]);
    this.name = "WeakPassphraseError";
    this.problem = problem;
  }
}

/** Throws WeakPassphraseError unless the passphrase is acceptable for a new vault. */
export function assertAcceptableNewPassphrase(passphrase: string): void {
  const problem = findNewPassphraseProblem(passphrase);
  if (problem) throw new WeakPassphraseError(problem);
}
