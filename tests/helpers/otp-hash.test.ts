import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStoredOtp, resetOtpIdentifier } from "./otp-hash";

const hash = (code: string) => createHash("sha256").update(code).digest("base64url");

describe("resetOtpIdentifier", () => {
  it("lower-cases and trims the email", () => {
    expect(resetOtpIdentifier("  Jane@Example.com ")).toBe("forget-password-otp-jane@example.com");
  });
});

describe("parseStoredOtp", () => {
  it("recovers a code from its hash and attempt counter", () => {
    expect(parseStoredOtp(`${hash("123456")}:0`)).toBe("123456");
    expect(parseStoredOtp(`${hash("000042")}:2`)).toBe("000042");
  });

  it("accepts a plain value", () => {
    expect(parseStoredOtp("654321:1")).toBe("654321");
  });

  // A hash that matches no code makes the helper try all 1,000,000 six-digit codes, which takes
  // seconds on a busy machine, so this case gets a longer limit than the 5 s default.
  it("throws on something that is not a 6-digit code", () => {
    expect(() => parseStoredOtp(`${hash("not-six-digits")}:0`)).toThrow();
  }, 30_000);
});
