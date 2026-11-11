// lib/account/delete-account.test.ts
// Unit tests with a fake database and a fake code checker. The real SQL and cascade are covered
// by tests/integration/delete-account.int.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, ScheduleState } from "@prisma/client";
import {
  AccountDeletionError,
  asNeonOtpServer,
  createNeonOtpChecker,
  deleteOwnAccount,
  emailsMatch,
  otpIdentifiersFor,
  parseDeleteAccountInput,
  releaseImpactFor,
  type DeleteAccountErrorCode,
  type OtpChecker,
  type OtpVerdict,
} from "./delete-account";
import { ValidationError } from "../auth/errors";

const AUTH_ID = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const SESSION = { authUserId: AUTH_ID, email: "Owner@Example.com" };

afterEach(() => vi.restoreAllMocks());

function fakeDb(state: ScheduleState | null) {
  const executed: Array<{ sql: string; values: unknown[] }> = [];
  const deleteMany = vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({ count: 1 }));
  const findUnique = vi.fn<(args: unknown) => Promise<{ authUserId: string } | null>>(async () => ({ authUserId: AUTH_ID }));
  const tx = {
    user: { deleteMany, findUnique },
    $executeRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executed.push({ sql: strings.join("?"), values });
      return 1;
    }),
  };
  const transaction = vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  const db = {
    checkInSchedule: { findUnique: vi.fn(async () => (state ? { state } : null)) },
    $transaction: transaction,
  } as unknown as PrismaClient;
  return { db, tx, deleteMany, findUnique, executed, transaction };
}

function otp(verdict: OtpVerdict = { ok: true }) {
  const check = vi.fn<OtpChecker["check"]>(async () => verdict);
  return { checker: { check } satisfies OtpChecker, check };
}

const valid = { confirmEmail: "owner@example.com", code: "123 456", acknowledgeReleaseImpact: false };

async function codeOf(p: Promise<unknown>): Promise<DeleteAccountErrorCode> {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(AccountDeletionError);
  return (err as AccountDeletionError).code;
}

describe("parseDeleteAccountInput", () => {
  it("accepts the three fields and trims the email", () => {
    expect(parseDeleteAccountInput({ confirmEmail: "  a@b.co ", code: "123456" })).toEqual({ confirmEmail: "a@b.co", code: "123456" });
  });
  it("rejects missing, oversized and unknown fields", () => {
    expect(() => parseDeleteAccountInput({})).toThrow(ValidationError);
    expect(() => parseDeleteAccountInput({ confirmEmail: "a@b.co" })).toThrow(ValidationError);
    expect(() => parseDeleteAccountInput({ confirmEmail: "a".repeat(300), code: "123456" })).toThrow(ValidationError);
    expect(() => parseDeleteAccountInput({ confirmEmail: "a@b.co", code: "123456", userId: "someone-else" })).toThrow(ValidationError);
    expect(() => parseDeleteAccountInput({ confirmEmail: "a@b.co", code: 123456 })).toThrow(ValidationError);
    expect(() => parseDeleteAccountInput(null)).toThrow(ValidationError);
  });
});

describe("releaseImpactFor", () => {
  it.each<[ScheduleState | null, string]>([
    [null, "NONE"],
    ["HEALTHY", "NONE"],
    ["REMINDER_DUE", "NONE"],
    ["GRACE_PERIOD", "NONE"],
    ["PAUSED", "NONE"],
    ["CANCELED", "NONE"],
    ["ESCALATION_PENDING", "IN_PROGRESS"],
    ["VERIFICATION_REQUIRED", "IN_PROGRESS"],
    ["RELEASE_HOLD", "IN_PROGRESS"],
    ["RELEASED", "RELEASED"],
  ])("%s -> %s", (state, expected) => {
    expect(releaseImpactFor(state)).toBe(expected);
  });
});

describe("emailsMatch and otpIdentifiersFor", () => {
  it("ignore case and surrounding spaces", () => {
    expect(emailsMatch(" Owner@Example.COM ", "owner@example.com")).toBe(true);
    expect(emailsMatch("owner@example.com", "other@example.com")).toBe(false);
  });
  it("lists the three code identifiers for the lower-cased address", () => {
    expect(otpIdentifiersFor("Owner@Example.com")).toEqual([
      "email-verification-otp-owner@example.com",
      "forget-password-otp-owner@example.com",
      "sign-in-otp-owner@example.com",
    ]);
  });
});

describe("deleteOwnAccount", () => {
  it("deletes: checks the code for the SESSION email, then removes the user and the identity in one transaction", async () => {
    const f = fakeDb("HEALTHY");
    const o = otp();
    const outcome = await deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "user_1", input: valid });
    expect(outcome).toEqual({ duskUserDeleted: true, identityDeleted: true });
    expect(o.check).toHaveBeenCalledWith({ email: "owner@example.com", otp: "123456" });
    expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.deleteMany).toHaveBeenCalledWith({ where: { id: "user_1" } });
    const [codes, identity] = f.executed;
    expect(codes.sql).toContain("neon_auth.verification");
    // The three identifiers are passed as one joined list of bound parameters (never spliced into the SQL text).
    expect((codes.values[0] as { values: string[] }).values).toEqual(["email-verification-otp-owner@example.com", "forget-password-otp-owner@example.com", "sign-in-otp-owner@example.com"]);
    expect(identity.sql).toContain('neon_auth."user"');
    expect(identity.values).toEqual([AUTH_ID]);
  });

  it("never checks the code against an email the browser sent", async () => {
    const f = fakeDb("HEALTHY");
    const o = otp();
    // The same address in a different case is accepted, but the code is always checked for the session email.
    await deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "u", input: { ...valid, confirmEmail: "OWNER@EXAMPLE.COM" } });
    expect(o.check.mock.calls[0][0].email).toBe("owner@example.com");
  });

  it("refuses a wrong confirmation email first: no code check, no transaction", async () => {
    const f = fakeDb("HEALTHY");
    const o = otp();
    expect(await codeOf(deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "u", input: { ...valid, confirmEmail: "someone@else.com" } }))).toBe("EMAIL_MISMATCH");
    expect(o.check).not.toHaveBeenCalled();
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it.each(["RELEASED", "VERIFICATION_REQUIRED", "RELEASE_HOLD", "ESCALATION_PENDING"] as const)(
    "while the plan is %s it needs the release box ticked, and refuses without spending a code try",
    async (state) => {
      const f = fakeDb(state);
      const o = otp();
      expect(await codeOf(deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "u", input: valid }))).toBe("ACKNOWLEDGEMENT_REQUIRED");
      expect(o.check).not.toHaveBeenCalled();
      expect(f.transaction).not.toHaveBeenCalled();
      await deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "u", input: { ...valid, acknowledgeReleaseImpact: true } });
      expect(f.transaction).toHaveBeenCalledTimes(1);
    }
  );

  it("a plan with no release needs no tick, and neither does a missing schedule", async () => {
    for (const state of ["HEALTHY", "GRACE_PERIOD", null] as const) {
      const f = fakeDb(state);
      await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: SESSION, userId: "u", input: valid });
      expect(f.transaction).toHaveBeenCalledTimes(1);
    }
  });

  it.each(["x", "12345", "1234567", "abcdef"])("refuses a badly formed code %j before asking Neon Auth", async (bad) => {
    const f = fakeDb("HEALTHY");
    const o = otp();
    expect(await codeOf(deleteOwnAccount({ db: f.db, otp: o.checker }, { session: SESSION, userId: "u", input: { ...valid, code: bad } }))).toBe("CODE_INVALID");
    expect(o.check).not.toHaveBeenCalled();
  });

  it.each<[OtpVerdict, DeleteAccountErrorCode]>([
    [{ ok: false, reason: "INVALID" }, "CODE_INVALID"],
    [{ ok: false, reason: "TOO_MANY_ATTEMPTS" }, "CODE_TOO_MANY_ATTEMPTS"],
    [{ ok: false, reason: "RATE_LIMITED" }, "CODE_CHECK_RATE_LIMITED"],
    [{ ok: false, reason: "UNAVAILABLE" }, "CODE_CHECK_UNAVAILABLE"],
  ])("a refused code (%j) deletes nothing", async (verdict, expected) => {
    const f = fakeDb("HEALTHY");
    expect(await codeOf(deleteOwnAccount({ db: f.db, otp: otp(verdict).checker }, { session: SESSION, userId: "u", input: valid }))).toBe(expected);
    expect(f.transaction).not.toHaveBeenCalled();
  });

  it("a failed transaction becomes a plain refusal that leaks nothing", async () => {
    const f = fakeDb("HEALTHY");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    f.transaction.mockRejectedValueOnce(new Error('permission denied for table "user" owner@example.com'));
    const err = await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: SESSION, userId: "u", input: valid }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountDeletionError);
    expect((err as AccountDeletionError).code).toBe("DELETION_FAILED");
    expect((err as Error).message).not.toContain("owner@example.com");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("owner@example.com");
  });

  it("fails closed when the sign-in id is not a UUID: nothing is deleted at all", async () => {
    const f = fakeDb("HEALTHY");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = { ...SESSION, authUserId: "1; DROP TABLE" };
    const err = await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: bad, userId: "u", input: valid }).catch((e: unknown) => e);
    expect((err as AccountDeletionError).code).toBe("DELETION_FAILED");
    expect(f.executed).toEqual([]);
    expect(f.deleteMany).not.toHaveBeenCalled();
  });

  it("a Dusk account that belongs to a different sign-in identity is never deleted", async () => {
    const f = fakeDb("HEALTHY");
    f.findUnique.mockResolvedValueOnce({ authUserId: "99999999-9999-4999-8999-999999999999" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const err = await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: SESSION, userId: "u", input: valid }).catch((e: unknown) => e);
    expect((err as AccountDeletionError).code).toBe("DELETION_FAILED");
    expect(f.deleteMany).not.toHaveBeenCalled();
    expect(f.executed).toEqual([]);
  });

  it("a repeated request (account already gone) reports it without failing", async () => {
    const f = fakeDb("HEALTHY");
    f.findUnique.mockResolvedValueOnce(null);
    f.deleteMany.mockResolvedValueOnce({ count: 0 });
    const outcome = await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: SESSION, userId: "u", input: valid });
    expect(outcome.duskUserDeleted).toBe(false);
  });

  it("every refusal carries a plain message and a sensible status", async () => {
    const f = fakeDb("RELEASED");
    const err = (await deleteOwnAccount({ db: f.db, otp: otp().checker }, { session: SESSION, userId: "u", input: valid }).catch((e: unknown) => e)) as AccountDeletionError;
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/tick the box/);
  });
});

describe("createNeonOtpChecker", () => {
  const server = (result: unknown) => {
    const checkVerificationOtp = vi.fn<(args: unknown) => Promise<never>>(async () => result as never);
    return { server: { emailOtp: { checkVerificationOtp } }, checkVerificationOtp };
  };
  const ask = (result: unknown) => createNeonOtpChecker(server(result).server).check({ email: "a@b.co", otp: "123456" });

  it("asks for the email-verification code of that exact address", async () => {
    const s = server({ data: { success: true }, error: null });
    await createNeonOtpChecker(s.server).check({ email: "a@b.co", otp: "123456" });
    expect(s.checkVerificationOtp).toHaveBeenCalledWith({ email: "a@b.co", type: "email-verification", otp: "123456" });
  });

  it("accepts only an explicit success: true", async () => {
    expect(await ask({ data: { success: true }, error: null })).toEqual({ ok: true });
    expect(await ask({ data: { success: false }, error: null })).toEqual({ ok: false, reason: "INVALID" });
    expect(await ask({ data: {}, error: null })).toEqual({ ok: false, reason: "INVALID" });
    expect(await ask({ data: null, error: null })).toEqual({ ok: false, reason: "INVALID" });
    expect(await ask({})).toEqual({ ok: false, reason: "INVALID" });
  });

  it("maps Neon Auth errors", async () => {
    expect(await ask({ data: null, error: { status: 400, code: "INVALID_OTP" } })).toEqual({ ok: false, reason: "INVALID" });
    expect(await ask({ data: null, error: { status: 400, code: "OTP_EXPIRED" } })).toEqual({ ok: false, reason: "INVALID" });
    expect(await ask({ data: null, error: { status: 403, code: "TOO_MANY_ATTEMPTS" } })).toEqual({ ok: false, reason: "TOO_MANY_ATTEMPTS" });
    expect(await ask({ data: null, error: { status: 429 } })).toEqual({ ok: false, reason: "RATE_LIMITED" });
    expect(await ask({ data: null, error: { status: 502, code: "NETWORK_ERROR" } })).toEqual({ ok: false, reason: "UNAVAILABLE" });
    expect(await ask({ data: null, error: { status: 500 } })).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });

  it("treats a thrown error as unavailable, never as success", async () => {
    const checkVerificationOtp = vi.fn(async () => {
      throw new Error("boom");
    });
    expect(await createNeonOtpChecker({ emailOtp: { checkVerificationOtp } }).check({ email: "a@b.co", otp: "123456" })).toEqual({ ok: false, reason: "UNAVAILABLE" });
  });
});

describe("asNeonOtpServer", () => {
  it("calls the SDK method with its own object as `this`", async () => {
    const emailOtp = {
      calls: [] as unknown[],
      async checkVerificationOtp(this: { calls: unknown[] }, args: unknown) {
        this.calls.push(args);
        return { data: { success: true }, error: null };
      },
    };
    const verdict = await createNeonOtpChecker(asNeonOtpServer({ emailOtp })).check({ email: "a@b.co", otp: "123456" });
    expect(verdict).toEqual({ ok: true });
    expect(emailOtp.calls).toHaveLength(1);
  });

  it("a missing method fails closed", async () => {
    for (const bad of [{}, { emailOtp: {} }, null, undefined]) {
      expect(await createNeonOtpChecker(asNeonOtpServer(bad)).check({ email: "a@b.co", otp: "123456" })).toEqual({ ok: false, reason: "UNAVAILABLE" });
    }
  });
});
