import { describe, expect, it, vi } from "vitest";
import {
  changePasswordWithCode,
  requestResetCode,
  resetPasswordWithCode,
  type PasswordAuthClient,
} from "./password-flows";

function makeClient(overrides: Partial<{
  send: () => Promise<unknown>;
  reset: () => Promise<unknown>;
  signIn: () => Promise<unknown>;
  session: () => Promise<unknown>;
  revoke: () => Promise<unknown>;
}> = {}) {
  const send = vi.fn(overrides.send ?? (async () => ({ data: { success: true }, error: null })));
  const reset = vi.fn(overrides.reset ?? (async () => ({ data: { success: true }, error: null })));
  const signIn = vi.fn(overrides.signIn ?? (async () => ({ data: {}, error: null })));
  const session = vi.fn(overrides.session ?? (async () => ({ data: { user: {} }, error: null })));
  const revoke = vi.fn(overrides.revoke ?? (async () => ({ data: { status: true }, error: null })));
  const client = {
    emailOtp: { sendVerificationOtp: send, resetPassword: reset },
    signIn: { email: signIn },
    getSession: session,
    revokeOtherSessions: revoke,
  } as unknown as PasswordAuthClient;
  return { client, send, reset, signIn, session, revoke };
}

const GOOD = { email: "Jane@Example.com", code: "123 456", password: "a-long-new-password", confirm: "a-long-new-password" };

describe("requestResetCode", () => {
  it("sends a forget-password code to the normalised email", async () => {
    const { client, send } = makeClient();
    expect(await requestResetCode(client, "  Jane@Example.com ")).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({ email: "jane@example.com", type: "forget-password" });
  });

  it("does not call the server for an obviously wrong email", async () => {
    const { client, send } = makeClient();
    const result = await requestResetCode(client, "not-an-email");
    expect(result.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns the same success for an email with no account (the server also says success)", async () => {
    const { client } = makeClient();
    expect(await requestResetCode(client, "nobody@example.com")).toEqual(await requestResetCode(client, "someone@example.com"));
  });

  it("surfaces a rate limit as a readable message", async () => {
    const { client } = makeClient({ send: async () => ({ data: null, error: { status: 429, message: "" } }) });
    const result = await requestResetCode(client, "a@b.co");
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/Wait a minute/) });
  });

  it("turns a thrown network error into a message instead of throwing", async () => {
    const { client } = makeClient({
      send: async () => {
        throw new Error("Failed to fetch");
      },
    });
    const result = await requestResetCode(client, "a@b.co");
    expect(result.ok).toBe(false);
  });
});

describe("resetPasswordWithCode", () => {
  it("strips the code, keeps the password exactly, and calls the server once", async () => {
    const { client, reset } = makeClient();
    expect(await resetPasswordWithCode(client, GOOD)).toEqual({ ok: true });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith({ email: "jane@example.com", otp: "123456", password: "a-long-new-password" });
  });

  it.each([
    ["short code", { ...GOOD, code: "123" }, /6 digits/],
    ["empty code", { ...GOOD, code: "" }, /6-digit code/],
    ["short password", { ...GOOD, password: "short", confirm: "short" }, /at least 10/],
    ["mismatch", { ...GOOD, confirm: "something-else-entirely" }, /don't match/],
    ["spaces only", { ...GOOD, password: " ".repeat(12), confirm: " ".repeat(12) }, /only spaces/],
  ])("rejects %s locally without using up a code attempt", async (_name, input, pattern) => {
    const { client, reset } = makeClient();
    const result = await resetPasswordWithCode(client, input);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(pattern) });
    expect(reset).not.toHaveBeenCalled();
  });

  it.each([
    ["INVALID_OTP", /isn't right/],
    ["OTP_EXPIRED", /expired/],
    ["TOO_MANY_ATTEMPTS", /Request a new code/],
  ])("maps the server error %s", async (code, pattern) => {
    const { client } = makeClient({ reset: async () => ({ data: null, error: { code, message: "raw", status: 400 } }) });
    expect(await resetPasswordWithCode(client, GOOD)).toEqual({ ok: false, message: expect.stringMatching(pattern) });
  });

  it("never puts the code or password in an error message", async () => {
    const { client } = makeClient({
      reset: async () => ({ data: null, error: { code: "INVALID_OTP", message: "otp 123456 pw a-long-new-password" } }),
    });
    const result = await resetPasswordWithCode(client, GOOD);
    expect(JSON.stringify(result)).not.toMatch(/123456|a-long-new-password/);
  });

  it("catches a thrown error", async () => {
    const { client } = makeClient({
      reset: async () => {
        throw new Error("offline");
      },
    });
    expect((await resetPasswordWithCode(client, GOOD)).ok).toBe(false);
  });
});

describe("changePasswordWithCode", () => {
  it("keeps the session and ends the other sessions when the server leaves this one alone", async () => {
    const { client, signIn, revoke } = makeClient();
    expect(await changePasswordWithCode(client, GOOD)).toEqual({ ok: true, otherSessionsEnded: true, needsSignIn: false });
    expect(signIn).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("signs this browser back in when the server ended every session, then ends the others", async () => {
    const { client, signIn, revoke } = makeClient({ session: async () => ({ data: null, error: null }) });
    expect(await changePasswordWithCode(client, GOOD)).toEqual({ ok: true, otherSessionsEnded: true, needsSignIn: false });
    expect(signIn).toHaveBeenCalledWith({ email: "jane@example.com", password: "a-long-new-password" });
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("asks the person to sign in when re-signing in fails", async () => {
    const { client, revoke } = makeClient({
      session: async () => ({ data: null }),
      signIn: async () => ({ data: null, error: { code: "INVALID_EMAIL_OR_PASSWORD" } }),
    });
    expect(await changePasswordWithCode(client, GOOD)).toEqual({ ok: true, otherSessionsEnded: true, needsSignIn: true });
    expect(revoke).not.toHaveBeenCalled();
  });

  it("reports that other devices were not signed out when that last step fails", async () => {
    const { client } = makeClient({ revoke: async () => ({ data: null, error: { message: "boom" } }) });
    expect(await changePasswordWithCode(client, GOOD)).toEqual({ ok: true, otherSessionsEnded: false, needsSignIn: false });
  });

  it("does not touch sessions at all when the code is wrong", async () => {
    const { client, session, signIn, revoke } = makeClient({
      reset: async () => ({ data: null, error: { code: "INVALID_OTP" } }),
    });
    const result = await changePasswordWithCode(client, GOOD);
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/isn't right/) });
    expect(session).not.toHaveBeenCalled();
    expect(signIn).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("rejects a weak password before any request", async () => {
    const { client, reset } = makeClient();
    const result = await changePasswordWithCode(client, { ...GOOD, password: "short", confirm: "short" });
    expect(result.ok).toBe(false);
    expect(reset).not.toHaveBeenCalled();
  });

  it("survives getSession throwing by trying to sign in", async () => {
    const { client, signIn } = makeClient({
      session: async () => {
        throw new Error("network");
      },
    });
    expect((await changePasswordWithCode(client, GOOD)).ok).toBe(true);
    expect(signIn).toHaveBeenCalled();
  });
});
