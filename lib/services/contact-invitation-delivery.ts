// lib/services/contact-invitation-delivery.ts
// Emails an invitation link to a contact and reports, honestly, whether it was delivered.
// A failed send never changes the contact: they stay PENDING_INVITE and the owner can resend.
import { scrubText } from "../observability/sentry-scrub";
import { INVITE_TTL_DAYS } from "../domain/invitation-status";
import type { ContactRecord } from "./contact-service";
import type { NotificationAndAuditService } from "./notification-audit-service";

export interface InvitationDeliveryResult {
  /** True only when the email provider accepted the message. */
  delivered: boolean;
}

/** One idempotency key per issued token: a repeated call for the same invite never sends twice. */
export function invitationIdempotencyKey(contact: Pick<ContactRecord, "id" | "inviteTokenHash">): string {
  return `contact-invite:${contact.id}:${(contact.inviteTokenHash ?? "none").slice(0, 16)}`;
}

export function buildInvitationUrl(appUrl: string, rawToken: string): string {
  return `${appUrl.replace(/\/$/, "")}/invite/${encodeURIComponent(rawToken)}`;
}

export async function sendContactInvitationEmail(
  notifier: Pick<NotificationAndAuditService, "sendNotificationWithFallback">,
  params: {
    ownerUserId: string;
    ownerName: string | null;
    contact: ContactRecord;
    rawToken: string;
    appUrl: string;
    now?: Date;
  }
): Promise<InvitationDeliveryResult> {
  const { contact } = params;
  try {
    const result = await notifier.sendNotificationWithFallback(
      {
        userId: params.ownerUserId,
        templateKey: "CONTACT_INVITATION",
        primaryEmail: contact.email,
        // No SMS fallback: a text that says "sign in to your dashboard" makes no sense to someone
        // who has no Dusk account.
        fallbackPhone: null,
        idempotencyKey: invitationIdempotencyKey(contact),
        templateVariables: {
          actionUrl: buildInvitationUrl(params.appUrl, params.rawToken),
          recipientName: contact.fullName,
          ownerName: params.ownerName,
          isBeneficiary: contact.isBeneficiary,
          isTrustedVerifier: contact.isTrustedVerifier,
          expiresInDays: INVITE_TTL_DAYS,
        },
      },
      params.now
    );
    return { delivered: result.delivered };
  } catch (err) {
    // A provider outage or a store error must not undo the invitation: report it and let the
    // owner press Resend. The message is scrubbed because it can echo the recipient address.
    console.error(
      "[contact-invitation] could not send invitation email",
      scrubText(err instanceof Error ? err.message : String(err))
    );
    return { delivered: false };
  }
}

export type InvitationEmailStatus = "SENT" | "FAILED";

/** What the owner's list needs to know about a contact. Never includes the token hash. */
export type DashboardContact = Omit<ContactRecord, "inviteTokenHash"> & {
  /** Whether the invitation email for the CURRENT link went out. Null once the person has answered. */
  invitationEmail: InvitationEmailStatus | null;
};

/**
 * Strips the credential-at-rest and adds the email state. For a waiting invitation, a missing or
 * failed delivery record both read as "not sent", so the owner is offered Resend.
 */
export function toDashboardContact(
  row: ContactRecord,
  deliveryStatusByKey: ReadonlyMap<string, string>
): DashboardContact {
  const { inviteTokenHash, ...rest } = row;
  let invitationEmail: InvitationEmailStatus | null = null;
  if (row.status === "PENDING_INVITE" && inviteTokenHash) {
    const status = deliveryStatusByKey.get(invitationIdempotencyKey(row));
    invitationEmail = status === "SENT" || status === "DELIVERED" ? "SENT" : "FAILED";
  }
  return { ...rest, invitationEmail };
}
