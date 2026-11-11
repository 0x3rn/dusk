// lib/auth/client-errors.test.ts
import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./client-errors";

describe("authErrorMessage", () => {
  it("maps known Better Auth codes to friendly text (thrown AuthHttpError shape)", () => {
    const thrown = { code: "invalid_credentials", status: 400, error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "raw", status: 401 } };
    expect(authErrorMessage(thrown, "fallback")).toBe("That email and password don't match.");
  });

  it("maps known codes on a plain { code, message } result", () => {
    expect(authErrorMessage({ code: "INVALID_OTP", message: "Invalid OTP" }, "x")).toBe(
      "That code isn't right. Check it and try again."
    );
  });

  it("falls back to the server message for unknown codes", () => {
    expect(authErrorMessage({ error: { code: "SOMETHING_NEW", message: "Please slow down." } }, "x")).toBe(
      "Please slow down."
    );
  });

  it("uses the Error message when given an Error", () => {
    expect(authErrorMessage(new Error("Network down"), "x")).toBe("Network down");
  });

  it.each([[null], [undefined], ["text"], [42], [{}], [{ message: "   " }]])(
    "falls back for unusable input %j",
    (input) => {
      expect(authErrorMessage(input, "Sign in failed.")).toBe("Sign in failed.");
    }
  );
});

describe("authErrorMessage for one-time codes and password reset", () => {
  it.each([
    ["INVALID_OTP", /isn't right/],
    ["OTP_EXPIRED", /expired/],
    ["TOO_MANY_ATTEMPTS", /Request a new code/],
    ["PASSWORD_TOO_SHORT", /at least 10/],
    ["PASSWORD_TOO_LONG", /128/],
    ["INVALID_EMAIL", /email/],
    ["USER_NOT_FOUND", /Request a new code/],
    ["INVALID_TOKEN", /Request a new one/],
    ["SESSION_EXPIRED", /Sign in again/],
  ])("maps %s on a result error", (code, pattern) => {
    expect(authErrorMessage({ code, message: "raw server text", status: 400 }, "x")).toMatch(pattern);
  });

  it("maps codes inside a thrown error body too", () => {
    expect(authErrorMessage({ error: { code: "OTP_EXPIRED", message: "raw" } }, "x")).toMatch(/expired/);
  });

  it("never reveals whether an account exists after a reset attempt", () => {
    const msg = authErrorMessage({ code: "USER_NOT_FOUND", message: "User not found" }, "x");
    expect(msg).not.toMatch(/not found|no account|doesn't exist/i);
  });

  it("turns a bare 429 into a wait message", () => {
    expect(authErrorMessage({ status: 429, message: "" }, "x")).toMatch(/Wait a minute/);
    expect(authErrorMessage({ error: { status: 429 } }, "x")).toMatch(/Wait a minute/);
  });

  it("does not leak the raw message when a code is known", () => {
    expect(authErrorMessage({ code: "INVALID_OTP", message: "otp 123456 mismatch" }, "x")).not.toMatch(/123456/);
  });
});
