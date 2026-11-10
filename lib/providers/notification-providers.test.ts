// lib/providers/notification-providers.test.ts
import { describe, expect, it } from "vitest";
import { createNotificationProviders } from "./notification-providers";

const base = {
  resendApiKey: "re_secret_key",
  resendFromEmail: "Dusk <alerts@dusk.app>",
  twilioAccountSid: "ACtest",
  twilioAuthToken: "twilio_secret_token",
  twilioPhoneNumber: "+15550001111",
  appUrl: "https://dusk.app",
};

function recorder(response: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, fetchImpl };
}

const emailArgs = {
  to: "owner@example.com",
  subject: "ignored",
  templateKey: "CHECKIN_REMINDER" as const,
  safeVariables: { actionUrl: "https://dusk.app/checkin/tok", recipientName: "Ada" },
};

describe("Resend email provider", () => {
  it("posts the rendered message with a bearer key and returns the provider id", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ id: "email_1" }));
    const p = createNotificationProviders({ ...base, fetchImpl });

    const res = await p.sendEmail(emailArgs);

    expect(res).toEqual({ ok: true, providerMessageId: "email_1" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer re_secret_key");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.to).toEqual(["owner@example.com"]);
    expect(body.subject).toBe("Dusk check-in reminder");
    expect(body.html).toContain("https://dusk.app/checkin/tok");
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [422, false],
  ])("status %i is retryable=%s", async (status, retryable) => {
    const { fetchImpl } = recorder(() => new Response("nope", { status }));
    const res = await createNotificationProviders({ ...base, fetchImpl }).sendEmail(emailArgs);
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(retryable);
  });

  it("treats a network failure or timeout as retryable and never leaks the API key", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed: connect ETIMEDOUT re_secret_key");
    };
    const res = await createNotificationProviders({ ...base, fetchImpl }).sendEmail(emailArgs);
    expect(res.ok).toBe(false);
    expect(res.retryable).toBe(true);
    expect(JSON.stringify(res)).not.toContain("re_secret_key");
  });

  it("fails visibly (not silently) when Resend is not configured", async () => {
    const res = await createNotificationProviders({ appUrl: base.appUrl }).sendEmail(emailArgs);
    expect(res).toMatchObject({ ok: false, retryable: false });
    expect(res.error).toMatch(/not configured/);
  });
});

describe("Twilio SMS provider", () => {
  const smsArgs = { to: "+15550199", body: "ignored", templateKey: "MISSED_CHECKIN_ESCALATION" as const };

  it("posts form-encoded with basic auth and no token link in the body", async () => {
    const { calls, fetchImpl } = recorder(() => Response.json({ sid: "SM123" }));
    const res = await createNotificationProviders({ ...base, fetchImpl }).sendSms(smsArgs);

    expect(res).toEqual({ ok: true, providerMessageId: "SM123" });
    expect(calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json");
    const auth = (calls[0].init?.headers as Record<string, string>).Authorization;
    expect(Buffer.from(auth.replace("Basic ", ""), "base64").toString()).toBe("ACtest:twilio_secret_token");
    const form = new URLSearchParams(String(calls[0].init?.body));
    expect(form.get("To")).toBe("+15550199");
    expect(form.get("From")).toBe("+15550001111");
    expect(form.get("Body")).toContain("https://dusk.app/dashboard");
  });

  it("classifies 5xx as retryable and 4xx as permanent", async () => {
    const down = recorder(() => new Response("x", { status: 503 }));
    const bad = recorder(() => new Response("x", { status: 400 }));
    expect((await createNotificationProviders({ ...base, fetchImpl: down.fetchImpl }).sendSms(smsArgs)).retryable).toBe(true);
    expect((await createNotificationProviders({ ...base, fetchImpl: bad.fetchImpl }).sendSms(smsArgs)).retryable).toBe(false);
  });

  it("fails visibly when Twilio is not configured", async () => {
    const res = await createNotificationProviders({ appUrl: base.appUrl }).sendSms(smsArgs);
    expect(res).toMatchObject({ ok: false, retryable: false });
  });
});
