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

describe("UPGRADE_VAULT_KDF", () => {
  const good = () => ({
    action: "UPGRADE_VAULT_KDF",
    expected: {
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 1).toString("base64"),
      keyVersion: 1,
    },
    next: {
      kdfAlgorithm: "ARGON2ID-19456-2-1",
      kdfSaltBase64: Buffer.alloc(16, 2).toString("base64"),
      wrappedMasterKeyCiphertext: Buffer.alloc(48, 3).toString("base64"),
      wrappedMasterKeyIv: Buffer.alloc(12, 4).toString("base64"),
    },
  });

  it("accepts the request the browser sends", () => {
    expect(parseDashboardAction(good()).action).toBe("UPGRADE_VAULT_KDF");
  });

  const mutate = (fn: (b: ReturnType<typeof good>) => void) => {
    const body = good();
    fn(body);
    return body;
  };

  it.each([
    ["a PBKDF2 target (downgrade)", mutate((b) => (b.next.kdfAlgorithm = "PBKDF2-SHA256-600000"))],
    ["weak Argon2id memory", mutate((b) => (b.next.kdfAlgorithm = "ARGON2ID-1024-2-1"))],
    ["weak Argon2id time cost", mutate((b) => (b.next.kdfAlgorithm = "ARGON2ID-19456-1-1"))],
    ["Argon2id memory above the ceiling", mutate((b) => (b.next.kdfAlgorithm = "ARGON2ID-4194304-2-1"))],
    ["malformed identifier", mutate((b) => (b.next.kdfAlgorithm = "ARGON2ID-19456-2-1; DROP TABLE"))],
    ["identifier with the kit suffix", mutate((b) => (b.next.kdfAlgorithm = "ARGON2ID-19456-2-1+PASSPHRASE"))],
    ["lower-case identifier", mutate((b) => (b.next.kdfAlgorithm = "argon2id-19456-2-1"))],
    ["an unknown algorithm", mutate((b) => (b.next.kdfAlgorithm = "SCRYPT-32768-8-1"))],
    ["an Argon2id starting point", mutate((b) => (b.expected.kdfAlgorithm = "ARGON2ID-19456-2-1"))],
    ["a weak PBKDF2 starting point", mutate((b) => (b.expected.kdfAlgorithm = "PBKDF2-SHA256-1000"))],
    ["a short salt", mutate((b) => (b.next.kdfSaltBase64 = Buffer.alloc(8, 2).toString("base64")))],
    ["a wrapped key of the wrong size", mutate((b) => (b.next.wrappedMasterKeyCiphertext = Buffer.alloc(47, 3).toString("base64")))],
    ["a 16-byte nonce", mutate((b) => (b.next.wrappedMasterKeyIv = Buffer.alloc(16, 4).toString("base64")))],
    ["a non-base64 wrap", mutate((b) => (b.next.wrappedMasterKeyCiphertext = "not base64!!"))],
    ["an oversized wrap", mutate((b) => (b.next.wrappedMasterKeyCiphertext = "A".repeat(5_000)))],
    ["a fractional key version", mutate((b) => (b.expected.keyVersion = 1.5))],
    ["a zero key version", mutate((b) => (b.expected.keyVersion = 0))],
    ["an object algorithm (filter injection)", { ...good(), next: { ...good().next, kdfAlgorithm: { not: "x" } } }],
    ["a missing expected block", { action: "UPGRADE_VAULT_KDF", next: good().next }],
    ["an extra field in next", { ...good(), next: { ...good().next, userId: "someone-else" } }],
    ["an extra top-level field (ownership override)", { ...good(), userId: "someone-else" }],
  ])("rejects %s with a ValidationError", (_label, body) => {
    expect(() => parseDashboardAction(body)).toThrow(ValidationError);
  });

  it("refuses a raw key anywhere in the body (zero-knowledge boundary)", () => {
    expect(() => parseDashboardAction({ ...good(), masterKey: "AAAA" })).toThrow(TrustBoundaryViolationError);
  });
});
