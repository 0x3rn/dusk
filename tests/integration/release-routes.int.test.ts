// tests/integration/release-routes.int.test.ts
// Verifier link -> release -> beneficiary unlock, driven through the real route handlers
// against Postgres. Includes the attacks that must fail: replayed links, wrong email, wrong
// token, someone else's contact id, and two beneficiary clicks at once.
import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { createEngine } from "@/lib/engine/engine";
import { runSchedulerSweep } from "@/lib/engine/sweep";
import { POST as verifyPOST } from "@/app/api/verify/route";
import { POST as unlockPOST } from "@/app/api/unlock/[contactId]/route";
import { POST as checkinPOST } from "@/app/api/checkin/confirm/route";
import type { ExternalNotificationProviderPort } from "@/lib/services/notification-audit-service";

const DAY = 86_400_000;
let ipCounter = 0;
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${(ipCounter++ % 250) + 1}` },
    body: JSON.stringify(body),
  });

class CapturingProviders implements ExternalNotificationProviderPort {
  emails: Array<{ to: string; templateKey: string; actionUrl: string }> = [];
  async sendEmail(p: Parameters<ExternalNotificationProviderPort["sendEmail"]>[0]) {
    this.emails.push({ to: p.to, templateKey: p.templateKey, actionUrl: String(p.safeVariables.actionUrl ?? "") });
    return { ok: true, providerMessageId: "m" };
  }
  async sendSms() {
    return { ok: true, providerMessageId: "s" };
  }
}

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

async function releasedEstateReadyForVerifier() {
  const { user, schedule } = await createTestUser("release");
  created.push(user.id);
  const now = new Date();

  const verifier = await db.contact.create({
    data: {
      userId: user.id, fullName: "Vera", email: `vera.${user.id}@example.test`,
      isBeneficiary: false, isTrustedVerifier: true, status: "VERIFIED", verifiedAt: now,
    },
  });
  const beneficiary = await db.contact.create({
    data: {
      userId: user.id, fullName: "Ben", email: `ben.${user.id}@example.test`,
      isBeneficiary: true, isTrustedVerifier: false, status: "VERIFIED", verifiedAt: now,
      publicKeyBase64: Buffer.alloc(65, 9).toString("base64"),
    },
  });
  const stranger = await db.contact.create({
    data: {
      userId: user.id, fullName: "Sam", email: `sam.${user.id}@example.test`,
      isBeneficiary: true, isTrustedVerifier: false, status: "VERIFIED", verifiedAt: now,
      publicKeyBase64: Buffer.alloc(65, 3).toString("base64"),
    },
  });

  const vault = await db.vault.create({
    data: {
      userId: user.id, wrappedMasterKeyCiphertext: "x".repeat(24),
      wrappedMasterKeyIv: "y".repeat(16), kdfSaltBase64: "z".repeat(24),
    },
  });
  const assigned = await db.encryptedItem.create({
    data: {
      vaultId: vault.id, userId: user.id, category: "SECURE_NOTE",
      ciphertextBase64: "c".repeat(32), ivBase64: "i".repeat(16),
      wrappedItemKeyBase64: "w".repeat(32), wrappedItemKeyIvBase64: "v".repeat(16),
      aadResourceId: "res_assigned",
    },
  });
  const unassigned = await db.encryptedItem.create({
    data: {
      vaultId: vault.id, userId: user.id, category: "SECURE_NOTE",
      ciphertextBase64: "SECRET-NOT-ASSIGNED".padEnd(32, "x"), ivBase64: "i".repeat(16),
      wrappedItemKeyBase64: "w".repeat(32), wrappedItemKeyIvBase64: "v".repeat(16),
      aadResourceId: "res_unassigned",
    },
  });
  await db.releaseAssignment.create({
    data: {
      userId: user.id, contactId: beneficiary.id, itemId: assigned.id,
      beneficiaryWrappedKeyBase64: "k".repeat(32), beneficiaryWrappedKeyIv: "n".repeat(16),
      ephemeralPublicKeyBase64: "e".repeat(32), keyVersion: 1,
    },
  });

  // Put the estate where escalation has been exhausted: verification required.
  const due = new Date(now.getTime() - 40 * DAY);
  await db.checkInSchedule.update({
    where: { id: schedule.id },
    data: {
      state: "VERIFICATION_REQUIRED", remindersSentCount: 3,
      lastCheckInAt: new Date(due.getTime() - 90 * DAY), nextDueAt: due,
      graceEndsAt: new Date(due.getTime() + 14 * DAY),
    },
  });

  const providers = new CapturingProviders();
  const engine = createEngine({ db, providers, appUrl: "https://dusk.test" });
  return { user, schedule, verifier, beneficiary, stranger, assigned, unassigned, providers, engine, now };
}

const tokenFrom = (url: string) => new URL(url).pathname.split("/").pop()!;

describe("verifier link -> release -> beneficiary unlock (route handlers on Postgres)", () => {
  it("runs end to end and every attack on the way fails", async () => {
    const e = await releasedEstateReadyForVerifier();

    // 1. The sweep challenges the verifier. No release yet.
    await runSchedulerSweep(e.engine, { now: e.now, onlyScheduleIds: [e.schedule.id] });
    const challenge = e.providers.emails.find((m) => m.templateKey === "TRUSTED_VERIFIER_CHALLENGE")!;
    expect(challenge.to).toBe(e.verifier.email);
    const verifierToken = tokenFrom(challenge.actionUrl);
    expect((await db.checkInSchedule.findUniqueOrThrow({ where: { id: e.schedule.id } })).state).toBe(
      "VERIFICATION_REQUIRED"
    );

    // 2. Bad links are refused and do not consume anything.
    expect((await verifyPOST(post("/api/verify", { token: "x".repeat(40), action: "APPROVE", statement: "I know." }))).status).toBe(403);
    expect((await verifyPOST(post("/api/verify", { token: verifierToken, action: "NOPE", statement: "I know." }))).status).toBe(400);
    expect((await verifyPOST(post("/api/verify", { token: verifierToken, action: "APPROVE", statement: "ab" }))).status).toBe(400);

    // 3. The real verifier approves. A replay of the same link is refused.
    const ok = await verifyPOST(post("/api/verify", { token: verifierToken, action: "APPROVE", statement: "I attended the funeral." }));
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toContain(e.user.email); // reveals nothing about the owner
    const replay = await verifyPOST(post("/api/verify", { token: verifierToken, action: "APPROVE", statement: "I attended the funeral." }));
    expect(replay.status).toBe(403);

    // 4. Next sweep releases and sends the beneficiary one link.
    const r = await runSchedulerSweep(e.engine, { now: new Date(e.now.getTime() + 1000), onlyScheduleIds: [e.schedule.id] });
    expect(r.releasesAuthorized).toBe(1);
    // Each beneficiary gets exactly their own link (Ben and Sam are both beneficiaries).
    const pkg = e.providers.emails.filter((m) => m.templateKey === "RELEASE_PACKAGE_READY");
    expect(pkg.map((m) => m.to).sort()).toEqual([e.beneficiary.email, e.stranger.email].sort());
    const benToken = new URL(pkg.find((m) => m.to === e.beneficiary.email)!.actionUrl).searchParams.get("token")!;

    // 5. Attacks on the unlock endpoint.
    const unlock = (contactId: string, body: unknown) =>
      unlockPOST(post(`/api/unlock/${contactId}`, body), { params: Promise.resolve({ contactId }) });
    expect((await unlock(e.beneficiary.id, { rawAccessToken: benToken, beneficiaryEmail: "attacker@example.test" })).status).toBe(403); // wrong email
    expect((await unlock(e.beneficiary.id, { rawAccessToken: "t".repeat(40), beneficiaryEmail: e.beneficiary.email })).status).toBe(403); // wrong token
    expect((await unlock(e.stranger.id, { rawAccessToken: benToken, beneficiaryEmail: e.stranger.email })).status).toBe(403); // someone else's contact id

    // 6. Two simultaneous clicks of the right link: exactly one gets the package.
    const both = await Promise.all([
      unlock(e.beneficiary.id, { rawAccessToken: benToken, beneficiaryEmail: e.beneficiary.email }),
      unlock(e.beneficiary.id, { rawAccessToken: benToken, beneficiaryEmail: e.beneficiary.email }),
    ]);
    const statuses = both.map((x) => x.status).sort();
    expect(statuses).toEqual([200, 403]);
    const winner = await both.find((x) => x.status === 200)!.json();

    // 7. Only the assigned item is delivered; nothing else leaks.
    expect(winner.items).toHaveLength(1);
    expect(winner.items[0].itemId).toBe(e.assigned.id);
    expect(winner.items[0].vaultId).toBeTruthy();
    expect(JSON.stringify(winner)).not.toContain("SECRET-NOT-ASSIGNED");
    expect(JSON.stringify(winner)).not.toContain(e.unassigned.id);

    // 8. A later replay is refused; the acknowledgement works and is recorded.
    expect((await unlock(e.beneficiary.id, { rawAccessToken: benToken, beneficiaryEmail: e.beneficiary.email })).status).toBe(403);
    const ack = await unlock(e.beneficiary.id, {
      action: "ACKNOWLEDGE_RECEIPT", grantEventId: winner.grantEventId,
      beneficiaryEmail: e.beneficiary.email, decryptedCount: 1,
    });
    expect(ack.status).toBe(200);
    expect(
      await db.releaseEvent.count({ where: { scheduleId: e.schedule.id, eventType: "PACKAGE_RECEIPT_ACKNOWLEDGED" } })
    ).toBe(1);
  });

  it("a verifier saying 'alive' stops the release and returns the estate to healthy", async () => {
    const e = await releasedEstateReadyForVerifier();
    await runSchedulerSweep(e.engine, { now: e.now, onlyScheduleIds: [e.schedule.id] });
    const token = tokenFrom(e.providers.emails.find((m) => m.templateKey === "TRUSTED_VERIFIER_CHALLENGE")!.actionUrl);

    const res = await verifyPOST(post("/api/verify", { token, action: "ALIVE", statement: "I spoke with them today." }));
    expect(res.status).toBe(200);
    expect((await db.checkInSchedule.findUniqueOrThrow({ where: { id: e.schedule.id } })).state).toBe("HEALTHY");

    const r = await runSchedulerSweep(e.engine, { now: new Date(e.now.getTime() + 60_000), onlyScheduleIds: [e.schedule.id] });
    expect(r.releasesAuthorized).toBe(0);
    expect(e.providers.emails.some((m) => m.templateKey === "RELEASE_PACKAGE_READY")).toBe(false);
  });

  it("a verifier placing a hold blocks release", async () => {
    const e = await releasedEstateReadyForVerifier();
    await runSchedulerSweep(e.engine, { now: e.now, onlyScheduleIds: [e.schedule.id] });
    const token = tokenFrom(e.providers.emails.find((m) => m.templateKey === "TRUSTED_VERIFIER_CHALLENGE")!.actionUrl);

    expect((await verifyPOST(post("/api/verify", { token, action: "HOLD", statement: "Not sure this is real." }))).status).toBe(200);
    expect((await db.checkInSchedule.findUniqueOrThrow({ where: { id: e.schedule.id } })).state).toBe("RELEASE_HOLD");

    // Even a second approval cannot release while a hold is active.
    await runSchedulerSweep(e.engine, { now: new Date(e.now.getTime() + 60_000), onlyScheduleIds: [e.schedule.id] });
    expect((await db.checkInSchedule.findUniqueOrThrow({ where: { id: e.schedule.id } })).state).not.toBe("RELEASED");
  });

  it("the emailed check-in link works once and refuses a replay", async () => {
    const { user, schedule } = await createTestUser("checkinlink");
    created.push(user.id);
    await db.checkInSchedule.update({ where: { id: schedule.id }, data: { state: "GRACE_PERIOD", remindersSentCount: 1 } });
    const engine = createEngine({ db, providers: new CapturingProviders(), appUrl: "https://dusk.test" });
    const { rawCheckInToken } = await engine.checkIn.issueSingleUseCheckInToken(user.id);

    const first = await checkinPOST(post("/api/checkin/confirm", { token: rawCheckInToken }));
    expect(first.status).toBe(200);
    expect((await db.checkInSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).state).toBe("HEALTHY");
    expect((await checkinPOST(post("/api/checkin/confirm", { token: rawCheckInToken }))).status).toBe(403);
    expect((await checkinPOST(post("/api/checkin/confirm", { token: "short" }))).status).toBe(400);
  });
});
