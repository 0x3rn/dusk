import { describe, expect, it } from "vitest";

import { getAuditEventDisplay } from "./audit-event-copy";
import { ITEM_CATEGORIES, categoryLabel } from "./item-categories";

describe("getAuditEventDisplay", () => {
  it("explains events a person has seen in their own account in plain words", () => {
    expect(getAuditEventDisplay("ACCOUNT_CREATED", "{}")).toEqual({
      title: "Account created",
      description: "Your Dusk account was set up.",
    });
    expect(getAuditEventDisplay("AUTH_SIGNED_OUT", "{}").title).toBe("You signed out");
    expect(getAuditEventDisplay("LIFETIME_ACCESS_GRANTED", "{}").title).toBe("Payment received");
    expect(getAuditEventDisplay("LIFETIME_ACCESS_REVOKED", "{}").description).toContain("lifetime access has ended");
    expect(
      getAuditEventDisplay("LIFETIME_ACCESS_REVOKED", JSON.stringify({ accessKept: true })).description
    ).toContain("stays");
    expect(getAuditEventDisplay("LIFETIME_ACCESS_PARTIAL_REFUND", "{}").title).toBe("Partial refund");
  });

  it("names the person involved when the contact is known", () => {
    const contacts = [{ id: "c1", fullName: "Elena Ruiz" }];
    const verifier = getAuditEventDisplay(
      "VERIFIER_CHALLENGE_ISSUED",
      JSON.stringify({ contactId: "c1" }),
      contacts
    );
    expect(verifier.description).toContain("Elena Ruiz");

    const received = getAuditEventDisplay(
      "PACKAGE_RECEIPT_ACKNOWLEDGED",
      JSON.stringify({ contactId: "c1" }),
      contacts
    );
    expect(received.description).toContain("Elena Ruiz");
  });

  it("falls back to a generic label when the contact is not known", () => {
    const display = getAuditEventDisplay("VERIFIER_CHALLENGE_ISSUED", "not json at all");
    expect(display.description).toContain("A trusted verifier");
  });

  it("does not show the dashboard's built-in pause reason", () => {
    const display = getAuditEventDisplay(
      "CHECKIN_SCHEDULE_PAUSED",
      JSON.stringify({ pauseDays: 30, reason: "Paused from dashboard console" })
    );
    expect(display.description).toBe("Paused for 30 days.");
  });

  it("still shows a reason the owner wrote", () => {
    const display = getAuditEventDisplay(
      "CHECKIN_SCHEDULE_PAUSED",
      JSON.stringify({ pauseDays: 30, reason: "Travelling" })
    );
    expect(display.description).toBe("Paused for 30 days. Reason: Travelling.");
  });

  describe("invitation events", () => {
    const contacts = [{ id: "c1", fullName: "Elena Ruiz" }];
    const meta = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({ contactId: "c1", isBeneficiary: true, isTrustedVerifier: false, ...extra });

    it("says an invitation was sent, naming the person and the role", () => {
      const d = getAuditEventDisplay("CONTACT_INVITED", meta(), contacts);
      expect(d.title).toBe("Invitation sent");
      expect(d.description).toBe("Elena Ruiz was invited as a beneficiary. They can take part only after they accept.");
    });

    it("says an invitation was sent again and that the old link stopped working", () => {
      const d = getAuditEventDisplay("CONTACT_REINVITED", meta({ isTrustedVerifier: true }), contacts);
      expect(d.title).toBe("Invitation sent again");
      expect(d.description).toContain("beneficiary and trusted verifier");
      expect(d.description).toContain("earlier link no longer works");
    });

    it("explains accepted, declined, expired and cancelled in plain words", () => {
      expect(getAuditEventDisplay("CONTACT_INVITE_ACCEPTED", meta(), contacts)).toEqual({
        title: "Invitation accepted",
        description: "Elena Ruiz accepted as a beneficiary. They can now take part in a release.",
      });
      const declined = getAuditEventDisplay("CONTACT_INVITE_DECLINED", meta({ isBeneficiary: false, isTrustedVerifier: true }), contacts);
      expect(declined.title).toBe("Invitation declined");
      expect(declined.description).toContain("Elena Ruiz chose not to be a trusted verifier");
      const expired = getAuditEventDisplay("CONTACT_INVITE_EXPIRED", meta(), contacts);
      expect(expired.title).toBe("Invitation expired");
      expect(expired.description).toContain("did not accept in time");
      expect(getAuditEventDisplay("CONTACT_INVITE_CANCELED", meta(), contacts).title).toBe("Invitation cancelled");
    });

    it("falls back to a neutral name, never raw event codes", () => {
      const d = getAuditEventDisplay("CONTACT_INVITE_DECLINED", "{}");
      expect(d.description).toContain("A contact chose not to be a contact");
      expect(JSON.stringify(d)).not.toMatch(/CONTACT_|_INVITE/);
    });

    it("points a failed invitation email at Resend", () => {
      const d = getAuditEventDisplay(
        "SECURITY_NOTIFICATION_DELIVERY_FAILED",
        JSON.stringify({ templateKey: "CONTACT_INVITATION" })
      );
      expect(d.title).toBe("An email could not be sent");
      expect(d.description).toContain("Resend invitation");
    });
  });

  it("never shows developer wording for an event it does not know", () => {
    const display = getAuditEventDisplay("SOMETHING_NEW_HAPPENED", "{}");
    expect(display.title).toBe("Something new happened");
    expect(display.description).toBe("Recorded on your account.");
  });
});

describe("categoryLabel", () => {
  it("gives every stored category a readable label", () => {
    for (const category of ITEM_CATEGORIES) {
      expect(categoryLabel(category.value)).toBe(category.label);
      expect(categoryLabel(category.value)).not.toMatch(/_/);
    }
  });

  it("does not show a raw value for an unknown category", () => {
    expect(categoryLabel("SOMETHING_ELSE")).toBe("Other note");
  });
});
