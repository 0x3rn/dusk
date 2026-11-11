import { describe, expect, it } from "vitest";
import { checkOtp, looksLikeEmail, normalizeEmail, normalizeOtp } from "./one-time-code";
import { secondsLeft } from "./cooldown";

describe("normalizeOtp / checkOtp", () => {
  it("strips spaces, dashes and letters", () => {
    expect(normalizeOtp(" 123 456 ")).toBe("123456");
    expect(normalizeOtp("123-456")).toBe("123456");
    expect(normalizeOtp("12a3b456")).toBe("123456");
  });

  it("accepts exactly six digits", () => {
    expect(checkOtp("123456")).toEqual({ ok: true, code: "123456" });
    expect(checkOtp("123 456")).toEqual({ ok: true, code: "123456" });
  });

  it.each([[""], ["   "], ["12345"], ["1234567"], ["abcdef"]])("rejects %j", (raw) => {
    const result = checkOtp(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message.length).toBeGreaterThan(5);
  });

  it("keeps leading zeros", () => {
    expect(checkOtp("000123")).toEqual({ ok: true, code: "000123" });
  });
});

describe("email helpers", () => {
  it("lower-cases and trims", () => {
    expect(normalizeEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
  });

  it("catches obvious typos only", () => {
    expect(looksLikeEmail("a@b.co")).toBe(true);
    expect(looksLikeEmail("a@b")).toBe(false);
    expect(looksLikeEmail("a b@c.com")).toBe(false);
    expect(looksLikeEmail("")).toBe(false);
  });
});

describe("secondsLeft", () => {
  it("counts down, rounds up and never goes negative", () => {
    expect(secondsLeft(60_000, 0)).toBe(60);
    expect(secondsLeft(60_000, 59_001)).toBe(1);
    expect(secondsLeft(60_000, 60_000)).toBe(0);
    expect(secondsLeft(60_000, 90_000)).toBe(0);
  });
});
