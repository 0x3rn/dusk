// lib/api/dashboard-actions.test.ts
import { describe, expect, it } from "vitest";
import { parseDashboardAction } from "./dashboard-actions";
import { TrustBoundaryViolationError } from "../domain/trust-boundary";
import { ValidationError } from "../auth/security";

const key = Buffer.alloc(65, 7).toString("base64");
const goodContact = {
  action: "ADD_CONTACT",
  contact: {
    fullName: " Ben ",
    email: " Ben@Example.COM ",
    phone: null,
    isBeneficiary: true,
    isTrustedVerifier: false,
    publicKeyBase64: key,
  },
};
const goodAssignment = {
  action: "ASSIGN_ITEM_TO_BENEFICIARY",
  assignment: {
    contactId: "c1",
    itemId: "i1",
    keyVersion: 1,
    beneficiaryWrappedKeyBase64: Buffer.alloc(48, 1).toString("base64"),
    beneficiaryWrappedKeyIv: Buffer.alloc(12, 2).toString("base64"),
    ephemeralPublicKeyBase64: key,
  },
};

describe("parseDashboardAction", () => {
  it("accepts the shapes the dashboard sends and normalises the contact", () => {
    const c = parseDashboardAction(goodContact);
    expect(c.action === "ADD_CONTACT" && c.contact.email).toBe("ben@example.com");
    expect(c.action === "ADD_CONTACT" && c.contact.fullName).toBe("Ben");
    expect(parseDashboardAction(goodAssignment).action).toBe("ASSIGN_ITEM_TO_BENEFICIARY");
    expect(parseDashboardAction({ action: "CHECK_IN_NOW", idempotencyKey: "abcdefgh" }).action).toBe("CHECK_IN_NOW");
    expect(
      parseDashboardAction({ action: "UPDATE_SCHEDULE_CONFIG", intervalDays: 30, gracePeriodDays: 7 }).action
    ).toBe("UPDATE_SCHEDULE_CONFIG");
  });

  it("accepts resend and cancel invitation actions", () => {
    expect(parseDashboardAction({ action: "RESEND_INVITE", contactId: "cnt_1" }).action).toBe("RESEND_INVITE");
    expect(parseDashboardAction({ action: "CANCEL_INVITE", contactId: "cnt_1" }).action).toBe("CANCEL_INVITE");
  });

  it("accepts an empty-string phone as no phone", () => {
    const c = parseDashboardAction({ ...goodContact, contact: { ...goodContact.contact, phone: "" } });
    expect(c.action === "ADD_CONTACT" && c.contact.phone).toBeNull();
  });

  it.each([
    ["null body", null],
    ["array body", []],
    ["missing action", {}],
    ["unknown action", { action: "DROP_TABLE" }],
    ["contact missing", { action: "ADD_CONTACT" }],
    ["contact email not an email", { ...goodContact, contact: { ...goodContact.contact, email: "nope" } }],
    [
      "contact with no role",
      { ...goodContact, contact: { ...goodContact.contact, isBeneficiary: false, isTrustedVerifier: false } },
    ],
    ["beneficiary without key", { ...goodContact, contact: { ...goodContact.contact, publicKeyBase64: null } }],
    ["huge name", { ...goodContact, contact: { ...goodContact.contact, fullName: "a".repeat(5000) } }],
    ["key is not base64", { ...goodContact, contact: { ...goodContact.contact, publicKeyBase64: "!!!!" } }],
    ["object id (Prisma filter injection)", { action: "DELETE_ENCRYPTED_ITEM", itemId: { not: "x" } }],
    ["object contactId", { action: "REVOKE_CONTACT", contactId: { contains: "" } }],
    ["object contactId on resend", { action: "RESEND_INVITE", contactId: { contains: "" } }],
    ["object contactId on cancel", { action: "CANCEL_INVITE", contactId: { not: "x" } }],
    ["resend without contactId", { action: "RESEND_INVITE" }],
    ["unassign with object itemId", { action: "UNASSIGN_ITEM_FROM_BENEFICIARY", contactId: "c", itemId: { not: "" } }],
    [
      "assignment wrapped key too big",
      {
        ...goodAssignment,
        assignment: { ...goodAssignment.assignment, beneficiaryWrappedKeyBase64: "A".repeat(100_000) },
      },
    ],
    ["assignment keyVersion negative", { ...goodAssignment, assignment: { ...goodAssignment.assignment, keyVersion: -1 } }],
    ["pauseDays as string", { action: "PAUSE_SCHEDULE", pauseDays: "30" }],
    ["INIT_VAULT without bundle", { action: "INIT_VAULT" }],
  ])("rejects %s with a ValidationError", (_label, body) => {
    expect(() => parseDashboardAction(body)).toThrow(ValidationError);
  });

  it("refuses plaintext secrets anywhere in the body (zero-knowledge boundary)", () => {
    expect(() =>
      parseDashboardAction({ action: "ADD_ENCRYPTED_ITEM", item: { vaultId: "v", plaintext: "hunter2" } })
    ).toThrow(TrustBoundaryViolationError);
    expect(() =>
      parseDashboardAction({ action: "INIT_VAULT", vaultBundle: { nested: { masterKey: "AAAA" } } })
    ).toThrow(TrustBoundaryViolationError);
  });
});
