import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  checkNewPassword,
  checkNewPasswordPair,
} from "./password-policy";

describe("checkNewPassword", () => {
  it("rejects an empty password", () => {
    expect(checkNewPassword("")).toMatchObject({ ok: false, issue: "empty" });
  });

  it("rejects a whitespace-only password even when long enough", () => {
    expect(checkNewPassword(" ".repeat(20))).toMatchObject({ ok: false, issue: "only_spaces" });
    expect(checkNewPassword("\t\n  　 ".repeat(3))).toMatchObject({ ok: false, issue: "only_spaces" });
  });

  it("enforces the minimum length boundary", () => {
    expect(checkNewPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toMatchObject({ ok: false, issue: "too_short" });
    expect(checkNewPassword("a".repeat(MIN_PASSWORD_LENGTH))).toEqual({ ok: true });
    expect(checkNewPassword("a".repeat(MIN_PASSWORD_LENGTH + 1))).toEqual({ ok: true });
  });

  it("enforces the maximum length boundary", () => {
    expect(checkNewPassword("a".repeat(MAX_PASSWORD_LENGTH))).toEqual({ ok: true });
    expect(checkNewPassword("a".repeat(MAX_PASSWORD_LENGTH + 1))).toMatchObject({ ok: false, issue: "too_long" });
  });

  it("caps very long input without choking", () => {
    expect(checkNewPassword("x".repeat(1_000_000))).toMatchObject({ ok: false, issue: "too_long" });
  });

  it("counts visible characters, so a nine-character unicode password is too short", () => {
    expect(checkNewPassword("é".repeat(9))).toMatchObject({ ok: false, issue: "too_short" });
    expect(checkNewPassword("é".repeat(10))).toEqual({ ok: true });
    expect(checkNewPassword("日本語のパスワード1234")).toEqual({ ok: true });
  });

  it("counts an emoji once, not twice", () => {
    expect(checkNewPassword("\u{1F512}".repeat(9))).toMatchObject({ ok: false, issue: "too_short" });
    expect(checkNewPassword("\u{1F512}".repeat(10))).toEqual({ ok: true });
  });

  it("measures the upper cap in the same units as the server", () => {
    // 65 emoji are 65 visible characters but 130 UTF-16 units, which the server would refuse.
    expect(checkNewPassword("\u{1F512}".repeat(65))).toMatchObject({ ok: false, issue: "too_long" });
    expect(checkNewPassword("\u{1F512}".repeat(64))).toEqual({ ok: true });
  });

  it("allows spaces inside a password and does not trim", () => {
    expect(checkNewPassword("correct horse battery")).toEqual({ ok: true });
    expect(checkNewPassword("   a   b   ")).toEqual({ ok: true });
  });

  it("returns a plain-language message for every failure", () => {
    for (const bad of ["", "   ", "short", "a".repeat(500)]) {
      const result = checkNewPassword(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/\w/);
    }
  });
});

describe("checkNewPasswordPair", () => {
  it("accepts matching, valid passwords", () => {
    expect(checkNewPasswordPair("a-long-enough-one", "a-long-enough-one")).toEqual({ ok: true });
  });

  it("rejects a mismatch", () => {
    expect(checkNewPasswordPair("a-long-enough-one", "a-long-enough-two")).toMatchObject({
      ok: false,
      issue: "mismatch",
    });
  });

  it("treats a different case or trailing space as a mismatch", () => {
    expect(checkNewPasswordPair("a-long-enough-one", "A-long-enough-one")).toMatchObject({ issue: "mismatch" });
    expect(checkNewPasswordPair("a-long-enough-one", "a-long-enough-one ")).toMatchObject({ issue: "mismatch" });
  });

  it("reports the password problem before the mismatch", () => {
    expect(checkNewPasswordPair("short", "different")).toMatchObject({ issue: "too_short" });
    expect(checkNewPasswordPair("", "")).toMatchObject({ issue: "empty" });
  });

  it("requires the confirmation to be filled in", () => {
    expect(checkNewPasswordPair("a-long-enough-one", "")).toMatchObject({ issue: "mismatch" });
  });
});
