// lib/crypto/passphrase-policy.test.ts
import { describe, expect, it } from "vitest";
import {
  MAX_PASSPHRASE_LENGTH,
  MIN_NEW_PASSPHRASE_LENGTH,
  PASSPHRASE_HINT,
  PASSPHRASE_PROBLEM_MESSAGES,
  WeakPassphraseError,
  assertAcceptableNewPassphrase,
  findNewPassphraseProblem,
  passphraseLength,
} from "./passphrase-policy";

describe("new vault passphrase policy", () => {
  it("requires 12 characters", () => {
    expect(MIN_NEW_PASSPHRASE_LENGTH).toBe(12);
    expect(findNewPassphraseProblem("a".repeat(11))).toBe("too-short");
    expect(findNewPassphraseProblem("a".repeat(12))).toBeNull();
    expect(findNewPassphraseProblem("a".repeat(13))).toBeNull();
  });

  it("rejects the old 8-character minimum and empty input", () => {
    expect(findNewPassphraseProblem("abcdefgh")).toBe("too-short");
    expect(findNewPassphraseProblem("")).toBe("empty");
  });

  it("counts characters people see, not UTF-16 units", () => {
    expect(passphraseLength("café")).toBe(4);
    // Decomposed e + combining accent normalizes to one character.
    expect(passphraseLength("café")).toBe(4);
    // Each emoji is one character even though it takes two UTF-16 units.
    const sixEmoji = "\u{1F600}".repeat(6);
    expect(sixEmoji.length).toBe(12);
    expect(findNewPassphraseProblem(sixEmoji)).toBe("too-short");
    expect(findNewPassphraseProblem("\u{1F600}".repeat(12))).toBeNull();
  });

  it("does not trim spaces: they are part of the passphrase", () => {
    expect(findNewPassphraseProblem("           a")).toBeNull();
    expect(findNewPassphraseProblem("            ")).toBeNull();
  });

  it("rejects absurdly long input", () => {
    expect(findNewPassphraseProblem("a".repeat(MAX_PASSPHRASE_LENGTH))).toBeNull();
    expect(findNewPassphraseProblem("a".repeat(MAX_PASSPHRASE_LENGTH + 1))).toBe("too-long");
  });

  it("checks the confirmation only when one is given", () => {
    const good = "twelve chars!";
    expect(findNewPassphraseProblem(good, good)).toBeNull();
    expect(findNewPassphraseProblem(good, good + "x")).toBe("mismatch");
    expect(findNewPassphraseProblem(good, "")).toBe("mismatch");
    // Length problems win over a mismatch: fix the passphrase first.
    expect(findNewPassphraseProblem("short", "different")).toBe("too-short");
  });

  it("has plain-language text for every problem and a hint that states the rule", () => {
    for (const message of Object.values(PASSPHRASE_PROBLEM_MESSAGES)) {
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/kdf|argon|pbkdf|entropy|cryptograph/i);
    }
    expect(PASSPHRASE_PROBLEM_MESSAGES["too-short"]).toContain("12");
    expect(PASSPHRASE_HINT).toContain("12");
    expect(PASSPHRASE_HINT).not.toMatch(/kdf|argon|pbkdf|entropy/i);
  });

  it("assertAcceptableNewPassphrase throws a typed, plain-language error", () => {
    expect(() => assertAcceptableNewPassphrase("a".repeat(12))).not.toThrow();
    try {
      assertAcceptableNewPassphrase("elevenchars");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(WeakPassphraseError);
      expect((err as WeakPassphraseError).problem).toBe("too-short");
      expect((err as WeakPassphraseError).message).toBe(PASSPHRASE_PROBLEM_MESSAGES["too-short"]);
    }
  });
});
