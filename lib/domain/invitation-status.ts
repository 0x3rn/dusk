// lib/domain/invitation-status.ts
// Plain-language invitation state for a contact. Pure and free of server imports, so the
// dashboard (browser) and the server use the same rules.

/** How long an invitation link works. */
export const INVITE_TTL_DAYS = 14;
export const INVITE_TTL_MS = INVITE_TTL_DAYS * 24 * 60 * 60 * 1000;

export type InvitationState =
  /** Accepted: the only state that can take part in a release. */
  | "ACCEPTED"
  /** Invitation sent (or being sent) and still valid. */
  | "WAITING"
  /** The link ran out before they answered. */
  | "EXPIRED"
  | "DECLINED"
  | "PAUSED"
  | "REMOVED";

export interface InvitationStatusInput {
  status: "PENDING_INVITE" | "VERIFIED" | "SUSPENDED" | "REVOKED" | "DECLINED";
  inviteExpiresAt?: Date | string | null;
}

export function invitationStateOf(contact: InvitationStatusInput, now: Date = new Date()): InvitationState {
  switch (contact.status) {
    case "VERIFIED":
      return "ACCEPTED";
    case "DECLINED":
      return "DECLINED";
    case "SUSPENDED":
      return "PAUSED";
    case "REVOKED":
      return "REMOVED";
    case "PENDING_INVITE": {
      const expires = contact.inviteExpiresAt ? new Date(contact.inviteExpiresAt).getTime() : null;
      // No expiry on record means the link was already used up or withdrawn: treat as expired.
      return expires === null || expires <= now.getTime() ? "EXPIRED" : "WAITING";
    }
  }
}

export const INVITATION_STATE_LABEL: Record<InvitationState, string> = {
  ACCEPTED: "Accepted",
  WAITING: "Waiting for them to accept",
  EXPIRED: "Invitation expired",
  DECLINED: "Declined",
  PAUSED: "Paused",
  REMOVED: "Removed",
};

/** Only an accepted contact may be asked to verify, or be sent items. */
export function isAccepted(contact: InvitationStatusInput): boolean {
  return contact.status === "VERIFIED";
}
