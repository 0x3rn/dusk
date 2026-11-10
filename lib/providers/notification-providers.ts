// lib/providers/notification-providers.ts
// Resend (email) and Twilio (SMS) behind the ExternalNotificationProviderPort. They talk to the
// providers' REST APIs with fetch: a timeout on every call, retryable vs permanent failures told
// apart, and no secrets or message bodies ever written to logs.
import { renderEmail, renderSms } from "../notifications/templates";
import type { ExternalNotificationProviderPort } from "../services/notification-audit-service";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderConfig {
  resendApiKey?: string;
  resendFromEmail?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumber?: string;
  appUrl: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

type SendResult = { ok: boolean; providerMessageId?: string; error?: string; retryable?: boolean };

const NOT_CONFIGURED = (what: string): SendResult => ({
  ok: false,
  error: `${what} is not configured on this server.`,
  retryable: false,
});

/** 429 and 5xx are worth retrying; other 4xx mean the request itself is wrong. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readBodyForError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return "";
  }
}

export function createNotificationProviders(config: ProviderConfig): ExternalNotificationProviderPort {
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = config.timeoutMs ?? 10_000;

  return {
    async sendEmail({ to, templateKey, safeVariables }): Promise<SendResult> {
      if (!config.resendApiKey || !config.resendFromEmail) return NOT_CONFIGURED("Resend");
      const message = renderEmail(templateKey, safeVariables);
      try {
        const res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.resendFromEmail,
            to: [to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          return {
            ok: false,
            error: `Resend responded ${res.status}: ${await readBodyForError(res)}`,
            retryable: isRetryableStatus(res.status),
          };
        }
        const body = (await res.json().catch(() => ({}))) as { id?: unknown };
        return { ok: true, providerMessageId: typeof body.id === "string" ? body.id : undefined };
      } catch (err) {
        return {
          ok: false,
          error: `Resend request failed: ${err instanceof Error ? err.name : "unknown error"}`,
          retryable: true,
        };
      }
    },

    async sendSms({ to, templateKey }): Promise<SendResult> {
      const { twilioAccountSid: sid, twilioAuthToken: token, twilioPhoneNumber: from } = config;
      if (!sid || !token || !from) return NOT_CONFIGURED("Twilio");
      try {
        const res = await doFetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: from,
              To: to,
              Body: renderSms(templateKey, config.appUrl),
            }).toString(),
            signal: AbortSignal.timeout(timeoutMs),
          }
        );
        if (!res.ok) {
          return {
            ok: false,
            error: `Twilio responded ${res.status}: ${await readBodyForError(res)}`,
            retryable: isRetryableStatus(res.status),
          };
        }
        const body = (await res.json().catch(() => ({}))) as { sid?: unknown };
        return { ok: true, providerMessageId: typeof body.sid === "string" ? body.sid : undefined };
      } catch (err) {
        return {
          ok: false,
          error: `Twilio request failed: ${err instanceof Error ? err.name : "unknown error"}`,
          retryable: true,
        };
      }
    },
  };
}
