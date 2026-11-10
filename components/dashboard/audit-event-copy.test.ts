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
