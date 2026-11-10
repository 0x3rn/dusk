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
