// lib/domain/invitation-status.test.ts
import { describe, expect, it } from "vitest";
import {
  INVITATION_STATE_LABEL,
  INVITE_TTL_DAYS,
  INVITE_TTL_MS,
  invitationStateOf,
  isAccepted,
} from "./invitation-status";

const now = new Date("2026-11-10T12:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000);

describe("invitationStateOf", () => {
  it("an invitation lasts 14 days", () => {
    expect(INVITE_TTL_DAYS).toBe(14);
    expect(INVITE_TTL_MS).toBe(14 * 86_400_000);
  });

  it("maps each status to one plain state", () => {
    expect(invitationStateOf({ status: "VERIFIED" }, now)).toBe("ACCEPTED");
    expect(invitationStateOf({ status: "DECLINED" }, now)).toBe("DECLINED");
    expect(invitationStateOf({ status: "SUSPENDED" }, now)).toBe("PAUSED");
    expect(invitationStateOf({ status: "REVOKED" }, now)).toBe("REMOVED");
  });

  it("a pending invitation is waiting until its time runs out, then expired (boundary included)", () => {
    expect(invitationStateOf({ status: "PENDING_INVITE", inviteExpiresAt: inDays(1) }, now)).toBe("WAITING");
    expect(invitationStateOf({ status: "PENDING_INVITE", inviteExpiresAt: inDays(0) }, now)).toBe("EXPIRED");
    expect(invitationStateOf({ status: "PENDING_INVITE", inviteExpiresAt: inDays(-3) }, now)).toBe("EXPIRED");
    // JSON from the dashboard API carries the date as a string.
    expect(invitationStateOf({ status: "PENDING_INVITE", inviteExpiresAt: inDays(2).toISOString() }, now)).toBe("WAITING");
  });

  it("a pending contact with no expiry on record is not treated as waiting", () => {
    expect(invitationStateOf({ status: "PENDING_INVITE", inviteExpiresAt: null }, now)).toBe("EXPIRED");
    expect(invitationStateOf({ status: "PENDING_INVITE" }, now)).toBe("EXPIRED");
  });

  it("uses the words shown to the owner", () => {
    expect(INVITATION_STATE_LABEL.WAITING).toBe("Waiting for them to accept");
    expect(INVITATION_STATE_LABEL.ACCEPTED).toBe("Accepted");
    expect(INVITATION_STATE_LABEL.DECLINED).toBe("Declined");
    expect(INVITATION_STATE_LABEL.EXPIRED).toBe("Invitation expired");
  });

  it("only VERIFIED counts as accepted", () => {
    expect(isAccepted({ status: "VERIFIED" })).toBe(true);
    for (const status of ["PENDING_INVITE", "DECLINED", "SUSPENDED", "REVOKED"] as const) {
      expect(isAccepted({ status })).toBe(false);
    }
  });
});
