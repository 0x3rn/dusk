// tests/integration/api-security.int.test.ts
// The signed-in routes under attack, driven through the real route handlers against Postgres.
// The session is replaced by a fixed "attacker" user, so these tests prove what the server does
// when user B sends user A's ids, malformed bodies, cross-site requests, and too many requests.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";

type TestUser = Awaited<ReturnType<typeof createTestUser>>["user"];
const session: { user: TestUser | null } = { user: null };

vi.mock("@/lib/auth/server", () => ({
  auth: { signOut: vi.fn(), getSession: vi.fn(), listSessions: vi.fn() },
}));
vi.mock("@/lib/auth/current-user", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth/current-user")>();
  return {
    ...original,
    requireUser: async () => {
      if (!session.user) throw new Error("test session not set");
      return { user: session.user, authSession: { id: "sess_test" } };
    },
  };
});

import { GET as dashboardGET, POST as dashboardPOST } from "@/app/api/dashboard/route";
import { POST as vaultPOST } from "@/app/api/vault/route";
import { POST as checkoutPOST } from "@/app/api/checkout/route";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";

const ORIGIN = "http://localhost";
function post(url: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) {
  return new Request(`${ORIGIN}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const act = (body: unknown) => dashboardPOST(post("/api/dashboard", body));

const created: string[] = [];
const bucketKeys: string[] = [];
let attacker: TestUser;
let victim: TestUser;
const ids = {} as Record<"vault" | "folder" | "item" | "contact" | "assignment" | "attackerVault", string>;

beforeAll(async () => {
  attacker = (await createTestUser("attacker")).user;
  victim = (await createTestUser("victim")).user;
  created.push(attacker.id, victim.id);

  const mkVault = (userId: string) =>
    db.vault.create({
      data: { userId, wrappedMasterKeyCiphertext: "x".repeat(24), wrappedMasterKeyIv: "y".repeat(16), kdfSaltBase64: "z".repeat(24) },
    });
  const vault = await mkVault(victim.id);
  const attackerVault = await mkVault(attacker.id);
  const folder = await db.vaultFolder.create({
    data: { vaultId: vault.id, userId: victim.id, encryptedNameBase64: "a".repeat(24), nameIvBase64: "b".repeat(16) },
  });
  const item = await db.encryptedItem.create({
    data: {
      vaultId: vault.id, userId: victim.id, ciphertextBase64: "c".repeat(32), ivBase64: "i".repeat(16),
      wrappedItemKeyBase64: "w".repeat(32), wrappedItemKeyIvBase64: "v".repeat(16), aadResourceId: "res_victim",
    },
  });
  const contact = await db.contact.create({
    data: {
      userId: victim.id, fullName: "Ben", email: `ben.${victim.id}@example.test`, isBeneficiary: true,
      status: "VERIFIED", verifiedAt: new Date(), publicKeyBase64: Buffer.alloc(65, 1).toString("base64"),
      inviteTokenHash: `hash_${victim.id}`,
    },
  });
  const assignment = await db.releaseAssignment.create({
    data: {
      userId: victim.id, contactId: contact.id, itemId: item.id,
      beneficiaryWrappedKeyBase64: "k".repeat(24), beneficiaryWrappedKeyIv: "k".repeat(16), ephemeralPublicKeyBase64: "e".repeat(24),
    },
  });
  Object.assign(ids, {
    vault: vault.id, folder: folder.id, item: item.id, contact: contact.id,
    assignment: assignment.id, attackerVault: attackerVault.id,
  });
  session.user = attacker;
});

afterAll(async () => {
  await db.rateLimitBucket.deleteMany({ where: { key: { in: bucketKeys } } });
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

async function victimIsUntouched() {
  expect(await db.encryptedItem.count({ where: { vaultId: ids.vault } })).toBe(1);
  expect((await db.contact.findUniqueOrThrow({ where: { id: ids.contact } })).status).toBe("VERIFIED");
  expect(await db.releaseAssignment.count({ where: { id: ids.assignment } })).toBe(1);
}

describe("another user's ids (IDOR) through /api/dashboard", () => {
  const wrapped = {
    beneficiaryWrappedKeyBase64: Buffer.alloc(48, 1).toString("base64"),
    beneficiaryWrappedKeyIv: Buffer.alloc(12, 2).toString("base64"),
    ephemeralPublicKeyBase64: Buffer.alloc(65, 3).toString("base64"),
    keyVersion: 1,
  };

  it("cannot delete, revoke, unassign or assign against the victim's records", async () => {
    const responses = await Promise.all([
      act({ action: "DELETE_ENCRYPTED_ITEM", itemId: ids.item }),
      act({ action: "REVOKE_CONTACT", contactId: ids.contact }),
      act({ action: "UNASSIGN_ITEM_FROM_BENEFICIARY", contactId: ids.contact, itemId: ids.item }),
      act({ action: "ASSIGN_ITEM_TO_BENEFICIARY", assignment: { contactId: ids.contact, itemId: ids.item, ...wrapped } }),
    ]);
    expect(responses.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    await victimIsUntouched();
  });

  it("cannot add an item to the victim's vault, and a missing item looks the same as a foreign one", async () => {
    const envelope = {
      ciphertextBase64: Buffer.alloc(64, 1).toString("base64"), ivBase64: Buffer.alloc(12, 2).toString("base64"),
      wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"), wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
      aadResourceId: "res_attack",
    };
    const res = await act({ action: "ADD_ENCRYPTED_ITEM", item: { ...envelope, vaultId: ids.vault } });
    expect(res.status).toBe(403);
    await victimIsUntouched();

    const foreign = await (await act({ action: "DELETE_ENCRYPTED_ITEM", itemId: ids.item })).json();
    const missing = await (await act({ action: "DELETE_ENCRYPTED_ITEM", itemId: "does_not_exist" })).json();
    expect(foreign.error).toBe(missing.error);
    expect(JSON.stringify(foreign)).not.toContain(attacker.id);
  });

  it("cannot file an item under the victim's folder", async () => {
    const res = await act({
      action: "ADD_ENCRYPTED_ITEM",
      item: {
        vaultId: ids.attackerVault, folderId: ids.folder,
        ciphertextBase64: Buffer.alloc(64, 1).toString("base64"), ivBase64: Buffer.alloc(12, 2).toString("base64"),
        wrappedItemKeyBase64: Buffer.alloc(48, 3).toString("base64"), wrappedItemKeyIvBase64: Buffer.alloc(12, 4).toString("base64"),
        aadResourceId: "res_folder_attack",
      },
    });
    expect(res.status).toBe(400);
    expect(await db.encryptedItem.count({ where: { vaultId: ids.attackerVault } })).toBe(0);
  });
});

describe("malformed and hostile input", () => {
  it.each([
    ["malformed JSON", "{not json"],
    ["empty body", ""],
    ["unknown action", { action: "DROP_TABLE" }],
    ["missing contact", { action: "ADD_CONTACT" }],
    ["object used as an id", { action: "DELETE_ENCRYPTED_ITEM", itemId: { not: "x" } }],
    ["object used as an id on unassign", () => ({ action: "UNASSIGN_ITEM_FROM_BENEFICIARY", contactId: ids.contact, itemId: { not: "" } })],
    ["plaintext secret field", { action: "ADD_ENCRYPTED_ITEM", item: { vaultId: "v", plaintext: "hunter2" } }],
  ])("%s is a 400, never a 500", async (_label, body) => {
    const res = await dashboardPOST(post("/api/dashboard", typeof body === "function" ? body() : body));
    expect(res.status).toBe(400);
    await victimIsUntouched();
  });

  it("rejects an oversized body", async () => {
    const res = await dashboardPOST(post("/api/dashboard", { action: "CHECK_IN_NOW", pad: "a".repeat(3.5 * 1024 * 1024) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/);
  });
});

describe("cross-site requests", () => {
  const evil = { origin: "https://evil.example" };
  it("blocks cross-origin and origin-less posts on every state-changing signed-in route", async () => {
    for (const headers of [evil, {}]) {
      const results = await Promise.all([
        dashboardPOST(post("/api/dashboard", { action: "CHECK_IN_NOW" }, headers)),
        vaultPOST(post("/api/vault", {}, headers)),
        checkoutPOST(post("/api/checkout", {}, headers)),
      ]);
      expect(results.map((r) => r.status)).toEqual([403, 403, 403]);
    }
  });
});

describe("rate limits on signed-in routes", () => {
  async function exhaust(policy: { bucketName: string; maxAttempts: number; windowMs: number }, userId: string) {
    const windowStart = new Date(Math.floor(Date.now() / policy.windowMs) * policy.windowMs);
    const key = `${policy.bucketName}:${userId.toLowerCase()}`;
    bucketKeys.push(key);
    await db.rateLimitBucket.upsert({
      where: { key_windowStart: { key, windowStart } },
      create: { key, windowStart, count: policy.maxAttempts },
      update: { count: policy.maxAttempts },
    });
  }

  it("/api/dashboard answers 429 with Retry-After once a user is over the limit", async () => {
    await exhaust(RATE_LIMIT_POLICIES.DASHBOARD_MUTATION, attacker.id);
    const res = await dashboardPOST(post("/api/dashboard", { action: "CHECK_IN_NOW" }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Another user is unaffected by the attacker's bucket.
    session.user = victim;
    expect((await dashboardPOST(post("/api/dashboard", { action: "NOPE" }))).status).toBe(400);
    session.user = attacker;
  });

  it("/api/checkout stops opening checkouts after 10 an hour, before the payment provider is contacted", async () => {
    await exhaust(RATE_LIMIT_POLICIES.CHECKOUT_START, attacker.id);
    const res = await checkoutPOST(post("/api/checkout", {}));
    expect(res.status).toBe(429);
  });
});

describe("what GET /api/dashboard returns", () => {
  it("never includes invite token hashes", async () => {
    session.user = victim;
    const res = await dashboardGET();
    session.user = attacker;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contacts).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("inviteTokenHash");
    expect(JSON.stringify(body)).not.toContain(`hash_${victim.id}`);
  });
});
