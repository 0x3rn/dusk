// lib/account/delete-account-client.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  checkDeletionForm,
  impactNeedsAcknowledgement,
  loadReleaseImpact,
  requestDeletionCode,
  submitAccountDeletion,
  type DeletionAuthClient,
} from "./delete-account-client";

const clientReturning = (result: unknown) => {
  const sendVerificationOtp = vi.fn<DeletionAuthClient["emailOtp"]["sendVerificationOtp"]>(async () => result as never);
  const client: DeletionAuthClient = { emailOtp: { sendVerificationOtp } };
  return { client, sendVerificationOtp };
};

describe("requestDeletionCode", () => {
  it("asks for an email-verification code for the lower-cased account email", async () => {
    const c = clientReturning({ data: { success: true }, error: null });
    expect(await requestDeletionCode(c.client, " Owner@Example.com ")).toEqual({ ok: true });
    expect(c.sendVerificationOtp).toHaveBeenCalledWith({ email: "owner@example.com", type: "email-verification" });
  });

  it("turns a service error into a plain message", async () => {
    const r = await requestDeletionCode(clientReturning({ error: { code: "TOO_MANY_REQUESTS" } }).client, "a@b.co");
    expect(r).toEqual({ ok: false, message: "Too many requests. Wait a minute and try again." });
  });

  it("turns a thrown error into a plain message, never raw text", async () => {
    const client: DeletionAuthClient = {
      emailOtp: {
        sendVerificationOtp: async () => {
          throw new Error("ECONNREFUSED 10.0.0.1:443");
        },
      },
    };
    const r = await requestDeletionCode(client, "a@b.co");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).not.toContain("ECONNREFUSED");
  });
});

describe("checkDeletionForm", () => {
  const base = { accountEmail: "owner@example.com", confirmEmail: "OWNER@example.com", code: "123-456", impact: "NONE" as const, acknowledged: false };

  it("passes, and returns the cleaned code", () => {
    expect(checkDeletionForm(base)).toEqual({ ok: true, code: "123456" });
  });

  it("explains each problem next to its field", () => {
    const r = checkDeletionForm({ ...base, confirmEmail: "other@example.com", code: "12" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.code).toMatch(/6 digits/);
      expect(r.errors.confirmEmail).toMatch(/isn't the email on your account/);
      expect(r.errors.acknowledged).toBeUndefined();
    }
  });

  it("needs the box ticked whenever a release is, or might be, involved", () => {
    for (const impact of ["IN_PROGRESS", "RELEASED", "UNKNOWN"] as const) {
      expect(impactNeedsAcknowledgement(impact)).toBe(true);
      expect(checkDeletionForm({ ...base, impact }).ok).toBe(false);
      expect(checkDeletionForm({ ...base, impact, acknowledged: true }).ok).toBe(true);
    }
    expect(impactNeedsAcknowledgement("NONE")).toBe(false);
  });
});

describe("submitAccountDeletion", () => {
  const body = { confirmEmail: "a@b.co", code: "123456", acknowledgeReleaseImpact: false };
  const res = (ok: boolean, status: number, json: unknown) => ({ ok, status, json: async () => json });

  it("posts JSON to the delete route", async () => {
    const post = vi.fn<(url: string, init: RequestInit) => Promise<ReturnType<typeof res> extends Promise<infer R> ? R : ReturnType<typeof res>>>(async () => res(true, 200, { ok: true }));
    expect(await submitAccountDeletion(post, body)).toEqual({ ok: true });
    const [url, init] = post.mock.calls[0];
    expect(url).toBe("/api/account/delete");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("shows the server's plain message and code", async () => {
    const r = await submitAccountDeletion(async () => res(false, 400, { error: "That code isn't right.", code: "CODE_INVALID" }), body);
    expect(r).toEqual({ ok: false, message: "That code isn't right.", code: "CODE_INVALID" });
  });

  it("falls back to a plain message for a broken reply or a network failure", async () => {
    const broken = await submitAccountDeletion(
      async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      }),
      body
    );
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.message).toMatch(/nothing was deleted/);
    const offline = await submitAccountDeletion(async () => {
      throw new TypeError("Failed to fetch");
    }, body);
    expect(offline.ok).toBe(false);
    if (!offline.ok) expect(offline.message).toMatch(/nothing was deleted/);
  });
});

describe("loadReleaseImpact", () => {
  it("reads the three known answers", async () => {
    for (const v of ["NONE", "IN_PROGRESS", "RELEASED"]) {
      expect(await loadReleaseImpact(async () => ({ ok: true, json: async () => ({ releaseImpact: v }) }))).toBe(v);
    }
  });

  it("anything else, or a failure, is UNKNOWN (which asks for the extra tick)", async () => {
    expect(await loadReleaseImpact(async () => ({ ok: true, json: async () => ({ releaseImpact: "WHAT" }) }))).toBe("UNKNOWN");
    expect(await loadReleaseImpact(async () => ({ ok: false, json: async () => ({}) }))).toBe("UNKNOWN");
    expect(
      await loadReleaseImpact(async () => {
        throw new Error("x");
      })
    ).toBe("UNKNOWN");
  });
});
