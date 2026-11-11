// tests/integration/delete-account.int.test.ts
// Account deletion against the real schema on the Neon dev branch: exactly one person's rows go,
// the cascade is complete, the payment ledger stays, a failed or repeated request is safe.
// Throwaway accounts only; everything created here is removed afterwards.
import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "./helpers";
import { AccountDeletionError, deleteAccountRows, deleteOwnAccount, otpIdentifiersFor, type OtpChecker } from "@/lib/account/delete-account";

const TAG = `itest_del_${randomUUID().slice(0, 6)}`;
const createdEmails: string[] = [];
const createdAuthIds: string[] = [];
const ledgerIds: string[] = [];

interface Account {
  email: string;
  authUserId: string;
  userId: string;
  scheduleId: string;
}

/** A whole account: sign-in identity (user, two sessions, a password account, pending codes) and every kind of Dusk row. */
async function makeAccount(label: string): Promise<Account> {
  const email = `${TAG}_${label}@example.test`;
  createdEmails.push(email);

  const [neon] = await db.$queryRaw<Array<{ id: string }>>`
    INSERT INTO neon_auth."user" ("name", "email", "emailVerified", "updatedAt")
    VALUES (${`${TAG} ${label}`}, ${email}, true, now()) RETURNING "id"::text AS id`;
  const authUserId = neon.id;
  createdAuthIds.push(authUserId);
  for (const n of [1, 2]) {
    await db.$executeRaw`
      INSERT INTO neon_auth.session ("expiresAt", "token", "updatedAt", "userId")
      VALUES (now() + interval '7 days', ${`${TAG}_${label}_tok${n}`}, now(), ${authUserId}::uuid)`;
  }
  await db.$executeRaw`
    INSERT INTO neon_auth.account ("accountId", "providerId", "userId", "password", "updatedAt")
    VALUES (${authUserId}, 'credential', ${authUserId}::uuid, 'not-a-real-hash', now())`;
  for (const identifier of otpIdentifiersFor(email)) {
    await db.$executeRaw`
      INSERT INTO neon_auth.verification ("identifier", "value", "expiresAt")
      VALUES (${identifier}, 'x:0', now() + interval '5 minutes')`;
  }

  const user = await db.user.create({ data: { authUserId, email, fullName: `${TAG} ${label}` } });
  const now = new Date();
  const schedule = await db.checkInSchedule.create({
    data: { userId: user.id, state: "HEALTHY", lastCheckInAt: now, nextDueAt: new Date(now.getTime() + 90 * 86_400_000) },
  });
  const vault = await db.vault.create({
    data: { userId: user.id, wrappedMasterKeyCiphertext: "AAAA", wrappedMasterKeyIv: "AAAA", kdfSaltBase64: "AAAA" },
  });
  const folder = await db.vaultFolder.create({
    data: { vaultId: vault.id, userId: user.id, encryptedNameBase64: "AAAA", nameIvBase64: "AAAA" },
  });
  const item = await db.encryptedItem.create({
    data: {
      vaultId: vault.id,
      userId: user.id,
      folderId: folder.id,
      ciphertextBase64: "AAAA",
      ivBase64: "AAAA",
      wrappedItemKeyBase64: "AAAA",
      wrappedItemKeyIvBase64: "AAAA",
      aadResourceId: `${TAG}_${label}`,
    },
  });
  await db.encryptedFile.create({
    data: {
      vaultId: vault.id,
      userId: user.id,
      itemId: item.id,
      storageBlobKey: `${TAG}_${label}_blob`,
      sizeBytes: 10,
      ciphertextSha256Hex: "00",
      encryptedMetaBase64: "AAAA",
      metaIvBase64: "AAAA",
      blobIvBase64: "AAAA",
      wrappedFileKeyBase64: "AAAA",
      wrappedFileKeyIvBase64: "AAAA",
    },
  });
  const contact = await db.contact.create({
    data: { userId: user.id, fullName: "Someone", email: `${TAG}_${label}_c@example.test`, status: "VERIFIED", isBeneficiary: true },
  });
  await db.releaseAssignment.create({
    data: {
      userId: user.id,
      contactId: contact.id,
      itemId: item.id,
      beneficiaryWrappedKeyBase64: "AAAA",
      beneficiaryWrappedKeyIv: "AAAA",
      ephemeralPublicKeyBase64: "AAAA",
    },
  });
  await db.recoveryArtifact.create({
    data: { userId: user.id, recoveryWrappedVmKBase64: "AAAA", recoveryWrappedVmKIv: "AAAA", kdfSaltBase64: "AAAA", fingerprintHex: "abcd" },
  });
  await db.workflowEvent.create({
    data: { scheduleId: schedule.id, userId: user.id, fromState: "HEALTHY", toState: "REMINDER_DUE", reason: "itest", idempotencyKey: `${TAG}_${label}_wf`, actorType: "SYSTEM_SCHEDULER" },
  });
  await db.releaseEvent.create({ data: { scheduleId: schedule.id, userId: user.id, contactId: contact.id, eventType: "ITEST" } });
  await db.notificationDelivery.create({
    data: { userId: user.id, channel: "EMAIL", templateKey: "ITEST", recipientAddress: email, idempotencyKey: `${TAG}_${label}_n` },
  });
  await db.auditEvent.create({ data: { userId: user.id, eventType: "ITEST", actorType: "SYSTEM" } });
  const ledgerId = `itest:${TAG}:${label}`;
  ledgerIds.push(ledgerId);
  await db.paymentEvent.create({ data: { id: ledgerId, eventName: "order_created", orderId: `${TAG}_${label}`, userId: user.id, outcome: "GRANTED" } });

  return { email, authUserId, userId: user.id, scheduleId: schedule.id };
}

/** Row counts for everything that belongs to one account, in both schemas. */
async function footprint(a: Account) {
  const u = { userId: a.userId };
  const [neon] = await db.$queryRaw<Array<Record<string, number>>>`
    SELECT
      (SELECT count(*)::int FROM neon_auth."user" WHERE id = ${a.authUserId}::uuid) AS neonUser,
      (SELECT count(*)::int FROM neon_auth.session WHERE "userId" = ${a.authUserId}::uuid) AS neonSessions,
      (SELECT count(*)::int FROM neon_auth.account WHERE "userId" = ${a.authUserId}::uuid) AS neonAccounts,
      (SELECT count(*)::int FROM neon_auth.verification WHERE identifier IN (${otpIdentifiersFor(a.email)[0]}, ${otpIdentifiersFor(a.email)[1]}, ${otpIdentifiersFor(a.email)[2]})) AS neonCodes`;
  return {
    ...neon,
    user: await db.user.count({ where: { id: a.userId } }),
    vault: await db.vault.count({ where: u }),
    folders: await db.vaultFolder.count({ where: u }),
    items: await db.encryptedItem.count({ where: u }),
    files: await db.encryptedFile.count({ where: u }),
    contacts: await db.contact.count({ where: u }),
    assignments: await db.releaseAssignment.count({ where: u }),
    schedule: await db.checkInSchedule.count({ where: u }),
    workflow: await db.workflowEvent.count({ where: u }),
    releaseEvents: await db.releaseEvent.count({ where: u }),
    recovery: await db.recoveryArtifact.count({ where: u }),
    notifications: await db.notificationDelivery.count({ where: u }),
    audit: await db.auditEvent.count({ where: u }),
    ledger: await db.paymentEvent.count({ where: { userId: a.userId } }),
  };
}

const ZERO_EXCEPT_LEDGER = {
  neonuser: 0, neonsessions: 0, neonaccounts: 0, neoncodes: 0,
  user: 0, vault: 0, folders: 0, items: 0, files: 0, contacts: 0, assignments: 0,
  schedule: 0, workflow: 0, releaseEvents: 0, recovery: 0, notifications: 0, audit: 0, ledger: 1,
};

/** Postgres folds unquoted aliases to lower case; normalise so the comparison reads clearly. */
const lower = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
const stripCase = (a: Awaited<ReturnType<typeof footprint>>) =>
  lower(a) as Record<string, number>;
const expectedZero = lower(ZERO_EXCEPT_LEDGER);

const okOtp: OtpChecker = { check: async () => ({ ok: true }) };
const request = (a: Account, over: Partial<{ confirmEmail: string; code: string; acknowledgeReleaseImpact: boolean }> = {}) => ({
  session: { authUserId: a.authUserId, email: a.email },
  userId: a.userId,
  input: { confirmEmail: a.email, code: "123456", ...over },
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: TAG } } });
  await db.paymentEvent.deleteMany({ where: { id: { in: ledgerIds } } });
  for (const id of createdAuthIds) await db.$executeRaw`DELETE FROM neon_auth."user" WHERE id = ${id}::uuid`;
  for (const email of createdEmails) {
    await db.$executeRaw`DELETE FROM neon_auth.verification WHERE identifier IN (${otpIdentifiersFor(email)[0]}, ${otpIdentifiersFor(email)[1]}, ${otpIdentifiersFor(email)[2]})`;
  }
  await db.$disconnect();
});

describe("deleteOwnAccount (Postgres)", () => {
  it("deletes exactly one person: complete cascade, identity gone, ledger kept, everyone else untouched", async () => {
    const target = await makeAccount("target");
    const bystander = await makeAccount("bystander");
    const before = await footprint(target);
    expect(Object.values(before).every((n) => n >= 1)).toBe(true); // the fixture really has a row everywhere
    const bystanderBefore = await footprint(bystander);
    const totals = { users: await db.user.count(), neon: await db.$queryRaw`SELECT count(*)::int AS n FROM neon_auth."user"` };

    const outcome = await deleteOwnAccount({ db, otp: okOtp }, request(target));
    expect(outcome).toEqual({ duskUserDeleted: true, identityDeleted: true });

    expect(stripCase(await footprint(target))).toEqual(expectedZero);
    expect(await footprint(bystander)).toEqual(bystanderBefore);
    expect(await db.user.count()).toBe(totals.users - 1);
    const neonAfter = await db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM neon_auth."user"`;
    expect(neonAfter[0].n).toBe((totals.neon as Array<{ n: number }>)[0].n - 1);
    // The payment ledger entry is still there, unchanged.
    expect(await db.paymentEvent.findUnique({ where: { id: `itest:${TAG}:target` } })).toMatchObject({ userId: target.userId, outcome: "GRANTED" });
  });

  it("the same email can sign up again as a brand new account", async () => {
    const a = await makeAccount("again");
    await deleteOwnAccount({ db, otp: okOtp }, request(a));
    const [fresh] = await db.$queryRaw<Array<{ id: string }>>`
      INSERT INTO neon_auth."user" ("name", "email", "emailVerified", "updatedAt") VALUES ('again', ${a.email}, false, now()) RETURNING "id"::text AS id`;
    createdAuthIds.push(fresh.id);
    const user = await db.user.create({ data: { authUserId: fresh.id, email: a.email } });
    expect(user.id).not.toBe(a.userId);
    expect(await db.vault.count({ where: { userId: user.id } })).toBe(0);
  });

  it("a repeated or simultaneous request is safe: no error, nothing extra deleted", async () => {
    const a = await makeAccount("double");
    const bystander = await makeAccount("double_by");
    const bystanderBefore = await footprint(bystander);
    const results = await Promise.allSettled([
      deleteOwnAccount({ db, otp: okOtp }, request(a)),
      deleteOwnAccount({ db, otp: okOtp }, request(a)),
      deleteOwnAccount({ db, otp: okOtp }, request(a)),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const deletedBy = results.filter((r) => r.status === "fulfilled" && r.value.duskUserDeleted).length;
    expect(deletedBy).toBe(1);
    expect(stripCase(await footprint(a))).toEqual(expectedZero);
    expect(await footprint(bystander)).toEqual(bystanderBefore);
    // And a later repeat, after everything is gone, is still just a quiet success.
    expect(await deleteOwnAccount({ db, otp: okOtp }, request(a))).toEqual({ duskUserDeleted: false, identityDeleted: false });
  });

  it("a wrong code, a wrong typed email, or a missing release tick deletes nothing", async () => {
    const a = await makeAccount("refused");
    const before = await footprint(a);
    const refuse = (verdict: OtpChecker, req: ReturnType<typeof request>) => deleteOwnAccount({ db, otp: verdict }, req).catch((e: unknown) => e);

    const wrongCode = await refuse({ check: async () => ({ ok: false, reason: "INVALID" }) }, request(a));
    expect((wrongCode as AccountDeletionError).code).toBe("CODE_INVALID");
    const wrongEmail = await refuse(okOtp, request(a, { confirmEmail: "someone@else.test" }));
    expect((wrongEmail as AccountDeletionError).code).toBe("EMAIL_MISMATCH");

    await db.checkInSchedule.update({ where: { id: a.scheduleId }, data: { state: "RELEASED", releasedAt: new Date() } });
    const noTick = await refuse(okOtp, request(a));
    expect((noTick as AccountDeletionError).code).toBe("ACKNOWLEDGEMENT_REQUIRED");
    await db.checkInSchedule.update({ where: { id: a.scheduleId }, data: { state: "HEALTHY", releasedAt: null } });

    expect(await footprint(a)).toEqual(before);
  });

  it("a released plan can be deleted once the person has ticked the box", async () => {
    const a = await makeAccount("released");
    await db.checkInSchedule.update({ where: { id: a.scheduleId }, data: { state: "RELEASED", releasedAt: new Date() } });
    await deleteOwnAccount({ db, otp: okOtp }, request(a, { acknowledgeReleaseImpact: true }));
    expect(stripCase(await footprint(a))).toEqual(expectedZero);
  });

  it("is all or nothing: a failure after the deletes rolls everything back", async () => {
    const a = await makeAccount("rollback");
    const before = await footprint(a);
    await expect(
      db.$transaction(async (tx) => {
        await deleteAccountRows(tx, { userId: a.userId, authUserId: a.authUserId, email: a.email });
        throw new Error("simulated failure after the deletes");
      })
    ).rejects.toThrow("simulated failure");
    expect(await footprint(a)).toEqual(before);
  });

  it("refuses to pair one person's Dusk account with another person's sign-in, and deletes nothing", async () => {
    const a = await makeAccount("pair_a");
    const b = await makeAccount("pair_b");
    const beforeA = await footprint(a);
    const beforeB = await footprint(b);
    await expect(
      db.$transaction((tx) => deleteAccountRows(tx, { userId: a.userId, authUserId: b.authUserId, email: b.email }))
    ).rejects.toThrow(/do not belong together/);
    expect(await footprint(a)).toEqual(beforeA);
    expect(await footprint(b)).toEqual(beforeB);
  });

  it("a sign-in id that is not a UUID is refused before any SQL runs", async () => {
    const a = await makeAccount("baduuid");
    const before = await footprint(a);
    await expect(
      db.$transaction((tx) => deleteAccountRows(tx, { userId: a.userId, authUserId: "x'; DROP TABLE neon_auth.user;--", email: a.email }))
    ).rejects.toThrow();
    expect(await footprint(a)).toEqual(before);
  });
});
