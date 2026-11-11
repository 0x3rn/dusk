// lib/services/contact-invitation-delivery.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  buildInvitationUrl,
  invitationIdempotencyKey,
  sendContactInvitationEmail,
  toDashboardContact,
} from "./contact-invitation-delivery";
import type { ContactRecord } from "./contact-service";
import {
  NotificationAndAuditService,
  type ExternalNotificationProviderPort,
  type NotificationAndAuditPersistencePort,
  type NotificationDeliveryRecord,
} from "./notification-audit-service";

const contact: ContactRecord = {
  id: "cnt_1",
  userId: "usr_1",
  fullName: "Sam Reader",
  email: "sam@example.com",
  phone: "+15555550100",
  isBeneficiary: true,
  isTrustedVerifier: false,
  status: "PENDING_INVITE",
  inviteTokenHash: "a".repeat(64),
  inviteExpiresAt: new Date("2026-12-01T00:00:00Z"),
  verifiedAt: null,
  publicKeyBase64: "k".repeat(44),
  keyAlgorithm: "ECDH-P256-HKDF-AES256GCM",
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** A real NotificationAndAuditService over an in-memory store, so idempotency is the real logic. */
function realNotifier(provider: ExternalNotificationProviderPort) {
  const notifications = new Map<string, NotificationDeliveryRecord>();
  const store: NotificationAndAuditPersistencePort = {
    async findNotificationByIdempotencyKey(key) {
      return notifications.get(key) ?? null;
    },
    async upsertNotificationAttempt(data) {
      const { attemptIncrement, ...rest } = data;
      const record: NotificationDeliveryRecord = {
        id: `n_${notifications.size + 1}`,
        attemptCount: attemptIncrement,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...rest,
      };
      notifications.set(data.idempotencyKey, record);
      return record;
    },
    async listNotificationsByUserId() {
      return [...notifications.values()];
    },
    async appendAuditEvent(data) {
      return { id: "a1", ...data, redactedMeta: data.redactedMetaJson, createdAt: new Date() };
    },
    async listAuditEventsByUserId() {
      return [];
    },
  };
  return { notifier: new NotificationAndAuditService(store, provider), notifications };
}

describe("contact invitation delivery", () => {
  it("builds the link as <app>/invite/<token> without double slashes", () => {
    expect(buildInvitationUrl("https://dusk.app/", "tok_en-1")).toBe("https://dusk.app/invite/tok_en-1");
    expect(buildInvitationUrl("http://localhost:3202", "abc")).toBe("http://localhost:3202/invite/abc");
  });

  it("uses a different idempotency key for every issued token", () => {
    const a = invitationIdempotencyKey(contact);
    const b = invitationIdempotencyKey({ ...contact, inviteTokenHash: "b".repeat(64) });
    expect(a).not.toBe(b);
    expect(a.startsWith("contact-invite:cnt_1:")).toBe(true);
  });

  it("sends the CONTACT_INVITATION template with role, owner and link, and reports delivered", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true, providerMessageId: "m1" });
    const sendSms = vi.fn();
    const { notifier } = realNotifier({ sendEmail, sendSms });

    const result = await sendContactInvitationEmail(notifier, {
      ownerUserId: "usr_1",
      ownerName: "Grace",
      contact,
      rawToken: "rawtoken123",
      appUrl: "https://dusk.app",
    });

    expect(result).toEqual({ delivered: true });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe("sam@example.com");
    expect(call.templateKey).toBe("CONTACT_INVITATION");
    expect(call.safeVariables).toMatchObject({
      actionUrl: "https://dusk.app/invite/rawtoken123",
      ownerName: "Grace",
      isBeneficiary: true,
      isTrustedVerifier: false,
      expiresInDays: 14,
    });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("does not send the same invitation twice (retry with the same token is a no-op)", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: true });
    const { notifier } = realNotifier({ sendEmail, sendSms: vi.fn() });
    const params = { ownerUserId: "usr_1", ownerName: null, contact, rawToken: "rawtoken123", appUrl: "https://dusk.app" };

    await sendContactInvitationEmail(notifier, params);
    const again = await sendContactInvitationEmail(notifier, params);

    expect(again.delivered).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("reports not delivered when the provider is not configured, and never uses the phone", async () => {
    const sendEmail = vi.fn().mockResolvedValue({ ok: false, error: "Resend is not configured on this server.", retryable: false });
    const sendSms = vi.fn().mockResolvedValue({ ok: true });
    const { notifier, notifications } = realNotifier({ sendEmail, sendSms });

    const result = await sendContactInvitationEmail(notifier, {
      ownerUserId: "usr_1",
      ownerName: "Grace",
      contact,
      rawToken: "rawtoken123",
      appUrl: "https://dusk.app",
    });

    expect(result).toEqual({ delivered: false });
    expect(sendSms).not.toHaveBeenCalled();
    expect([...notifications.values()][0].status).toBe("FAILED");
  });

  it("reports not delivered (and does not throw) when sending itself throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const notifier = {
      sendNotificationWithFallback: vi.fn().mockRejectedValue(new Error("db down for sam@example.com")),
    };

    const result = await sendContactInvitationEmail(notifier, {
      ownerUserId: "usr_1",
      ownerName: null,
      contact,
      rawToken: "rawtoken123",
      appUrl: "https://dusk.app",
    });

    expect(result).toEqual({ delivered: false });
    // The address is scrubbed from the log line.
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("sam@example.com");
    errorSpy.mockRestore();
  });
});

describe("toDashboardContact", () => {
  it("never exposes the token hash and reports whether the current invitation email went out", () => {
    const key = invitationIdempotencyKey(contact);

    const sent = toDashboardContact(contact, new Map([[key, "DELIVERED"]]));
    expect(sent.invitationEmail).toBe("SENT");
    expect(sent).not.toHaveProperty("inviteTokenHash");

    expect(toDashboardContact(contact, new Map([[key, "FAILED"]])).invitationEmail).toBe("FAILED");
    // No record at all: nothing was sent.
    expect(toDashboardContact(contact, new Map()).invitationEmail).toBe("FAILED");
    // A delivery for an OLD token does not count for the new one.
    const oldKey = invitationIdempotencyKey({ ...contact, inviteTokenHash: "z".repeat(64) });
    expect(toDashboardContact(contact, new Map([[oldKey, "DELIVERED"]])).invitationEmail).toBe("FAILED");
  });

  it("has no email state once the person has answered or the link is gone", () => {
    expect(toDashboardContact({ ...contact, status: "VERIFIED", inviteTokenHash: null }, new Map()).invitationEmail).toBeNull();
    expect(toDashboardContact({ ...contact, status: "DECLINED", inviteTokenHash: null }, new Map()).invitationEmail).toBeNull();
    // Expired and withdrawn: the hash is cleared.
    expect(toDashboardContact({ ...contact, inviteTokenHash: null }, new Map()).invitationEmail).toBeNull();
  });
});
