// tests/integration/retention.int.test.ts
// The retention purge against the real Postgres schema on the Neon dev branch.
// Every row here belongs to throwaway "itest_" users and is removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { cleanupUser, createTestUser, db } from "./helpers";
import { createEngine } from "@/lib/engine/engine";
import { runSchedulerSweep } from "@/lib/engine/sweep";
import { computeCutoffs, runRetentionPurge, subtractMonthsUtc } from "@/lib/engine/retention";

const NOW = new Date();
const CUTOFF = subtractMonthsUtc(NOW, 12);
const ms = (n: number) => new Date(CUTOFF.getTime() + n);
const DAY = 86_400_000;
const monthsAgo = (m: number) => subtractMonthsUtc(NOW, m);
const TAG = `itest_ret_${randomUUID().slice(0, 6)}`;
const userIds: string[] = [];

type TestUser = Awaited<ReturnType<typeof createTestUser>>;

async function newUser(label: string): Promise<TestUser> {
  const t = await createTestUser(`${TAG}_${label}`);
  userIds.push(t.user.id);
  return t;
}

async function addAudit(userId: string, createdAt: Date, eventType = "ITEST_EVENT") {
  return db.auditEvent.create({ data: { userId, eventType, actorType: "SYSTEM", createdAt } });
}

async function addNotification(userId: string, createdAt: Date) {
  return db.notificationDelivery.create({
    data: { userId, channel: "EMAIL", templateKey: "ITEST", recipientAddress: "x@example.test", idempotencyKey: `${TAG}_${randomUUID()}`, createdAt },
  });
}

async function addReleaseEvent(t: TestUser, createdAt: Date, tokenExpiresAt: Date | null = null) {
  return db.releaseEvent.create({
    data: { scheduleId: t.schedule.id, userId: t.user.id, eventType: "ITEST_RELEASE_EVENT", createdAt, tokenExpiresAt },
  });
}

async function setReleased(t: TestUser, releasedAt: Date | null) {
  await db.checkInSchedule.update({ where: { id: t.schedule.id }, data: { state: "RELEASED", releasedAt } });
}

const exists = async (model: "auditEvent" | "notificationDelivery" | "releaseEvent", id: string) =>
  (await (db[model] as unknown as { count(a: unknown): Promise<number> }).count({ where: { id } })) === 1;

const mine = (userId: string) => ({
  audit: () => db.auditEvent.count({ where: { userId } }),
  notes: () => db.notificationDelivery.count({ where: { userId } }),
  release: () => db.releaseEvent.count({ where: { userId } }),
});

beforeAll(async () => {
  // Start from a clean slate so exact counts below are about our rows only.
  await runRetentionPurge(db, { now: NOW, maxRowsPerTable: 1_000_000 });
});

afterAll(async () => {
  for (const id of userIds) await cleanupUser(id);
  await db.rateLimitBucket.deleteMany({ where: { key: { startsWith: TAG } } });
  await db.$disconnect();
});

describe("retention purge (Postgres)", () => {
  it("purges old audit and message records, keeps fresh ones, and the boundary is exactly 12 months", async () => {
    const t = await newUser("age");
    const old = await addAudit(t.user.id, monthsAgo(13));
    const justOver = await addAudit(t.user.id, ms(-1));
    const exactly = await addAudit(t.user.id, ms(0));
    const justUnder = await addAudit(t.user.id, ms(1));
    const fresh = await addAudit(t.user.id, monthsAgo(1));
    const oldNote = await addNotification(t.user.id, monthsAgo(14));
    const noteExactly = await addNotification(t.user.id, ms(0));
    const freshNote = await addNotification(t.user.id, monthsAgo(2));

    const report = await runRetentionPurge(db, { now: NOW });
    expect(report.skipped).toBe(false);
    if (report.skipped) return;
    expect(report.counts.auditEvents).toBe(2);
    expect(report.counts.notificationDeliveries).toBe(1);

    expect(await exists("auditEvent", old.id)).toBe(false);
    expect(await exists("auditEvent", justOver.id)).toBe(false);
    expect(await exists("auditEvent", exactly.id)).toBe(true);
    expect(await exists("auditEvent", justUnder.id)).toBe(true);
    expect(await exists("auditEvent", fresh.id)).toBe(true);
    expect(await exists("notificationDelivery", oldNote.id)).toBe(false);
    expect(await exists("notificationDelivery", noteExactly.id)).toBe(true);
    expect(await exists("notificationDelivery", freshNote.id)).toBe(true);
  });

  it("is idempotent: running again deletes nothing more", async () => {
    const t = await newUser("idem");
    await addAudit(t.user.id, monthsAgo(20));
    await addNotification(t.user.id, monthsAgo(20));
    const first = await runRetentionPurge(db, { now: NOW });
    const second = await runRetentionPurge(db, { now: NOW });
    expect(first.skipped || first.counts.auditEvents).toBe(1);
    expect(second.skipped || second.counts).toEqual({ auditEvents: 0, notificationDeliveries: 0, releaseEvents: 0, rateLimitBuckets: 0 });
  });

  it("release records: only an estate released more than 12 months ago loses them, and only expired, old ones", async () => {
    const oldRelease = await newUser("oldrel");
    await setReleased(oldRelease, monthsAgo(13));
    const gone = await addReleaseEvent(oldRelease, monthsAgo(13));
    const goneExpiredLink = await addReleaseEvent(oldRelease, monthsAgo(13), monthsAgo(12));
    const keptLiveLink = await addReleaseEvent(oldRelease, monthsAgo(13), new Date(NOW.getTime() + DAY));
    const keptRecentEvent = await addReleaseEvent(oldRelease, monthsAgo(1));

    const recentRelease = await newUser("recrel");
    await setReleased(recentRelease, monthsAgo(11));
    const keptWithinWindow = await addReleaseEvent(recentRelease, monthsAgo(13));

    const justOver = await newUser("justover");
    await setReleased(justOver, ms(-1));
    const goneJustOver = await addReleaseEvent(justOver, ms(-1));
    const exactlyAt = await newUser("exact");
    await setReleased(exactlyAt, ms(0));
    const keptExactly = await addReleaseEvent(exactlyAt, monthsAgo(13));

    const live = await newUser("live"); // a plan that has not been released
    const keptLive = await addReleaseEvent(live, monthsAgo(24));
    await db.checkInSchedule.update({ where: { id: live.schedule.id }, data: { state: "VERIFICATION_REQUIRED" } });
    const hold = await newUser("hold");
    await db.checkInSchedule.update({ where: { id: hold.schedule.id }, data: { state: "RELEASE_HOLD" } });
    const keptHold = await addReleaseEvent(hold, monthsAgo(30));

    const report = await runRetentionPurge(db, { now: NOW });
    if (report.skipped) throw new Error("unexpected skip");
    expect(report.counts.releaseEvents).toBe(3);

    expect(await exists("releaseEvent", gone.id)).toBe(false);
    expect(await exists("releaseEvent", goneExpiredLink.id)).toBe(false);
    expect(await exists("releaseEvent", goneJustOver.id)).toBe(false);
    for (const kept of [keptLiveLink, keptRecentEvent, keptWithinWindow, keptExactly, keptLive, keptHold]) {
      expect(await exists("releaseEvent", kept.id)).toBe(true);
    }
  });

  it("audit and message records tied to a release inside its 12 months are kept; after that they go", async () => {
    const recent = await newUser("recentrel");
    await setReleased(recent, monthsAgo(6));
    await addAudit(recent.user.id, monthsAgo(15));
    await addNotification(recent.user.id, monthsAgo(15));
    const missingDate = await newUser("nodate");
    await setReleased(missingDate, null);
    await addAudit(missingDate.user.id, monthsAgo(15));
    const longAgo = await newUser("longago");
    await setReleased(longAgo, monthsAgo(13));
    await addAudit(longAgo.user.id, monthsAgo(15));
    await addNotification(longAgo.user.id, monthsAgo(15));

    await runRetentionPurge(db, { now: NOW });

    expect(await mine(recent.user.id).audit()).toBe(1);
    expect(await mine(recent.user.id).notes()).toBe(1);
    expect(await mine(missingDate.user.id).audit()).toBe(1);
    expect(await mine(longAgo.user.id).audit()).toBe(0);
    expect(await mine(longAgo.user.id).notes()).toBe(0);
  });

  it("purges old rate-limit windows and keeps current and future ones", async () => {
    const old = new Date(NOW.getTime() - 3 * DAY);
    const recent = new Date(NOW.getTime() - 60_000);
    const future = new Date(NOW.getTime() + 3_600_000);
    await db.rateLimitBucket.createMany({
      data: [
        { key: `${TAG}:old`, windowStart: old, count: 1 },
        { key: `${TAG}:recent`, windowStart: recent, count: 1 },
        { key: `${TAG}:future`, windowStart: future, count: 1 },
      ],
    });
    await runRetentionPurge(db, { now: NOW });
    const left = await db.rateLimitBucket.findMany({ where: { key: { startsWith: TAG } }, select: { key: true } });
    expect(left.map((r) => r.key).sort()).toEqual([`${TAG}:future`, `${TAG}:recent`]);
  });

  it("never touches another user's recent data, or anything outside the four tables", async () => {
    const other = await newUser("other");
    await db.contact.create({ data: { userId: other.user.id, fullName: "Keep Me", email: `${TAG}@example.test` } });
    await addAudit(other.user.id, monthsAgo(1));
    await addNotification(other.user.id, monthsAgo(1));
    await addReleaseEvent(other, monthsAgo(1));
    const doomed = await newUser("doomed");
    await addAudit(doomed.user.id, monthsAgo(18));

    const before = {
      users: await db.user.count(),
      schedules: await db.checkInSchedule.count(),
      contacts: await db.contact.count(),
      workflow: await db.workflowEvent.count(),
      payments: await db.paymentEvent.count(),
    };
    await runRetentionPurge(db, { now: NOW });
    expect({
      users: await db.user.count(),
      schedules: await db.checkInSchedule.count(),
      contacts: await db.contact.count(),
      workflow: await db.workflowEvent.count(),
      payments: await db.paymentEvent.count(),
    }).toEqual(before);
    expect(await mine(other.user.id).audit()).toBe(1);
    expect(await mine(other.user.id).notes()).toBe(1);
    expect(await mine(other.user.id).release()).toBe(1);
    expect(await mine(doomed.user.id).audit()).toBe(0);
  });

  it("a dry run reports the count and deletes nothing", async () => {
    const t = await newUser("dry");
    await addAudit(t.user.id, monthsAgo(13));
    await addAudit(t.user.id, monthsAgo(13));
    const report = await runRetentionPurge(db, { now: NOW, dryRun: true });
    if (report.skipped) throw new Error("unexpected skip");
    expect(report.dryRun).toBe(true);
    expect(report.counts.auditEvents).toBe(2);
    expect(await mine(t.user.id).audit()).toBe(2);
    // Leave no eligible rows behind, so the exact counts in the next tests are about their own rows.
    await runRetentionPurge(db, { now: NOW });
    expect(await mine(t.user.id).audit()).toBe(0);
  });

  it("respects the per-run cap and the batch size, and a later run finishes the job", async () => {
    const t = await newUser("cap");
    for (let i = 0; i < 12; i++) await addAudit(t.user.id, monthsAgo(13 + (i % 3)));

    const first = await runRetentionPurge(db, { now: NOW, batchSize: 2, maxRowsPerTable: 5 });
    if (first.skipped) throw new Error("unexpected skip");
    expect(first.counts.auditEvents).toBe(5);
    expect(first.capped).toContain("auditEvents");
    expect(await mine(t.user.id).audit()).toBe(7);

    const second = await runRetentionPurge(db, { now: NOW, batchSize: 3, maxRowsPerTable: 100 });
    if (second.skipped) throw new Error("unexpected skip");
    expect(second.counts.auditEvents).toBe(7);
    expect(second.capped).toEqual([]);
    expect(await mine(t.user.id).audit()).toBe(0);
  });

  it("two runs at the same moment are safe: nothing is deleted twice and nothing fails", async () => {
    const t = await newUser("race");
    for (let i = 0; i < 30; i++) await addAudit(t.user.id, monthsAgo(14));
    const reports = await Promise.all([
      runRetentionPurge(db, { now: NOW, batchSize: 5 }),
      runRetentionPurge(db, { now: NOW, batchSize: 5 }),
      runRetentionPurge(db, { now: NOW, batchSize: 5 }),
    ]);
    const deleted = reports.reduce((sum, r) => sum + (r.skipped ? 0 : r.counts.auditEvents), 0);
    expect(deleted).toBe(30);
    expect(await mine(t.user.id).audit()).toBe(0);
  });

  it("a run that finds the lock taken is skipped and changes nothing", async () => {
    const t = await newUser("lock");
    await addAudit(t.user.id, monthsAgo(14));
    let held!: () => void;
    const release = new Promise<void>((resolve) => (held = resolve));
    let locked!: () => void;
    const lockedAcquired = new Promise<void>((resolve) => (locked = resolve));
    // Hold the purge's own lock key in another transaction, exactly as a running purge would.
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(727275)::text AS l`;
        locked();
        await release;
      },
      { timeout: 30_000 }
    );
    await lockedAcquired;
    const skipped = await runRetentionPurge(db, { now: NOW });
    expect(skipped).toEqual({ skipped: true });
    expect(await mine(t.user.id).audit()).toBe(1);
    held();
    await holder;
    const after = await runRetentionPurge(db, { now: NOW });
    expect(after.skipped).toBe(false);
    expect(await mine(t.user.id).audit()).toBe(0);
  });

  it("after the purge, the sweep leaves an old release alone instead of notifying everyone again", async () => {
    const t = await newUser("sweep");
    await setReleased(t, monthsAgo(13));
    await db.contact.create({
      data: { userId: t.user.id, fullName: "Old Beneficiary", email: `${TAG}_ben@example.test`, status: "VERIFIED", isBeneficiary: true, publicKeyBase64: "AAAA" },
    });
    const sent: string[] = [];
    const engine = createEngine({
      db,
      appUrl: "https://dusk.test",
      providers: {
        sendEmail: async ({ to }: { to: string }) => {
          sent.push(to);
          return { providerMessageId: "m", accepted: true };
        },
        sendSms: async () => ({ providerMessageId: "s", accepted: true }),
      } as never,
    });
    await addReleaseEvent(t, monthsAgo(13)); // stands in for the old grant record
    await runRetentionPurge(db, { now: NOW });
    expect(await mine(t.user.id).release()).toBe(0);

    const report = await runSchedulerSweep(engine, { now: NOW, onlyScheduleIds: [t.schedule.id] });
    expect(report.examined).toBe(0);
    expect(report.beneficiaryGrantsIssued).toBe(0);
    expect(sent).toEqual([]);

    // A release inside its 12 months is still examined as before.
    const fresh = await newUser("sweepfresh");
    await setReleased(fresh, monthsAgo(11));
    const again = await runSchedulerSweep(engine, { now: NOW, onlyScheduleIds: [fresh.schedule.id] });
    expect(again.examined).toBe(1);
  });

  it("computeCutoffs agrees with the SQL boundary it feeds", () => {
    expect(computeCutoffs(NOW).retention.getTime()).toBe(CUTOFF.getTime());
  });
});
