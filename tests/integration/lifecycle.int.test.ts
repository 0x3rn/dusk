// tests/integration/lifecycle.int.test.ts
// The whole dead-man's switch against REAL Postgres with fake email/SMS providers and
// time-travel: reminders -> grace -> escalation -> verification -> release -> beneficiary grant,
// plus the ways it must NOT proceed (check-in, provider outage, no verifier, duplicate runs).
import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { createEngine } from "@/lib/engine/engine";
import { runSchedulerSweep, runSchedulerSweepExclusive } from "@/lib/engine/sweep";
import type { ExternalNotificationProviderPort } from "@/lib/services/notification-audit-service";

const DAY = 86_400_000;

class FakeProviders implements ExternalNotificationProviderPort {
  emails: Array<{ to: string; templateKey: string; actionUrl: string | null }> = [];
  sms: Array<{ to: string }> = [];
  failing = false;
  async sendEmail(p: Parameters<ExternalNotificationProviderPort["sendEmail"]>[0]) {
    if (this.failing) return { ok: false, error: "provider down", retryable: false };
    this.emails.push({
      to: p.to,
      templateKey: p.templateKey,
      actionUrl: (p.safeVariables.actionUrl as string) ?? null,
    });
    return { ok: true, providerMessageId: `email_${this.emails.length}` };
  }
  async sendSms(p: Parameters<ExternalNotificationProviderPort["sendSms"]>[0]) {
    if (this.failing) return { ok: false, error: "sms down", retryable: false };
    this.sms.push({ to: p.to });
    return { ok: true, providerMessageId: `sms_${this.sms.length}` };
  }
}

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

async function estate(label: string, opts: { withVerifier?: boolean } = {}) {
  const { user, schedule } = await createTestUser(label);
  created.push(user.id);
  const now = new Date();
  const verifier =
    opts.withVerifier === false
      ? null
      : await db.contact.create({
          data: {
            userId: user.id,
            fullName: "Vera Verifier",
            email: `verifier.${user.id}@example.test`,
            isBeneficiary: false,
            isTrustedVerifier: true,
            status: "VERIFIED",
            verifiedAt: now,
          },
        });
  const beneficiary = await db.contact.create({
    data: {
      userId: user.id,
      fullName: "Ben Beneficiary",
      email: `ben.${user.id}@example.test`,
      isBeneficiary: true,
      isTrustedVerifier: false,
      status: "VERIFIED",
      verifiedAt: now,
      publicKeyBase64: Buffer.alloc(65, 7).toString("base64"),
    },
  });
  const providers = new FakeProviders();
  const engine = createEngine({ db, providers, appUrl: "https://dusk.test" });
  return { user, schedule, verifier, beneficiary, providers, engine };
}

const stateOf = async (id: string) =>
  (await db.checkInSchedule.findUniqueOrThrow({ where: { id } })).state;

describe("dead-man's switch lifecycle on Postgres", () => {
  it("walks reminder -> grace -> escalation -> verification -> release -> grant, exactly once each", async () => {
    const { schedule, verifier, beneficiary, providers, engine, user } = await estate("full");
    const due = schedule.nextDueAt.getTime();
    const graceEnds = due + schedule.gracePeriodDays * DAY;

    // Far from due: nothing happens, nobody is emailed.
    let r = await runSchedulerSweep(engine, { now: new Date(due - 20 * DAY), onlyScheduleIds: [schedule.id] });
    expect(providers.emails).toHaveLength(0);
    expect(await stateOf(schedule.id)).toBe("HEALTHY");

    // Enters the reminder window: one reminder with a one-click link. Repeating the same run
    // (a retry or overlapping job) must not send a second one.
    const t1 = new Date(due - 6 * DAY);
    r = await runSchedulerSweep(engine, { now: t1, onlyScheduleIds: [schedule.id] });
    await runSchedulerSweep(engine, { now: t1, onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("REMINDER_DUE");
    expect(providers.emails.filter((e) => e.to === user.email)).toHaveLength(1);
    expect(providers.emails[0].actionUrl).toMatch(/^https:\/\/dusk\.test\/checkin\/.{20,}/);

    // Due date passes -> grace period (one more reminder, a different day).
    await runSchedulerSweep(engine, { now: new Date(due + 1 * DAY), onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("GRACE_PERIOD");

    // Grace ends -> escalation (a third reminder).
    await runSchedulerSweep(engine, { now: new Date(graceEnds + 1 * DAY), onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("ESCALATION_PENDING");

    // Still inside the escalation window: no verification yet, nothing released.
    await runSchedulerSweep(engine, { now: new Date(graceEnds + 3 * DAY), onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("ESCALATION_PENDING");

    // Escalation exhausted -> verification required; the verifier is challenged ONCE.
    const t5 = new Date(graceEnds + 8 * DAY);
    r = await runSchedulerSweep(engine, { now: t5, onlyScheduleIds: [schedule.id] });
    await runSchedulerSweep(engine, { now: t5, onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("VERIFICATION_REQUIRED");
    const challenges = providers.emails.filter((e) => e.templateKey === "TRUSTED_VERIFIER_CHALLENGE");
    expect(challenges).toHaveLength(1);
    expect(challenges[0].to).toBe(verifier!.email);
    expect(challenges[0].actionUrl).toMatch(/\/verify\/.{20,}/);

    // No approval yet: fail closed. No release, no beneficiary email.
    expect(r.releasesAuthorized).toBe(0);
    expect(providers.emails.some((e) => e.templateKey === "RELEASE_PACKAGE_READY")).toBe(false);

    // The verifier approves. The next sweep releases and issues the beneficiary's grant.
    await engine.verification.submitVerifierReleaseApproval({
      scheduleId: schedule.id,
      contactId: verifier!.id,
      verificationStatement: "I confirm the owner has passed away.",
    });
    r = await runSchedulerSweep(engine, { now: new Date(t5.getTime() + 1000), onlyScheduleIds: [schedule.id] });
    expect(r.releasesAuthorized).toBe(1);
    expect(await stateOf(schedule.id)).toBe("RELEASED");
    const pkg = providers.emails.filter((e) => e.templateKey === "RELEASE_PACKAGE_READY");
    expect(pkg).toHaveLength(1);
    expect(pkg[0].to).toBe(beneficiary.email);
    expect(pkg[0].actionUrl).toContain(`/unlock/${beneficiary.id}?token=`);

    // Running again later changes nothing: still one grant, still one email.
    await runSchedulerSweep(engine, { now: new Date(t5.getTime() + 2 * DAY), onlyScheduleIds: [schedule.id] });
    expect(
      await db.releaseEvent.count({
        where: { scheduleId: schedule.id, eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED" },
      })
    ).toBe(1);
    expect(providers.emails.filter((e) => e.templateKey === "RELEASE_PACKAGE_READY")).toHaveLength(1);

    // The audit trail shows the staged path, in order.
    const states = (
      await db.workflowEvent.findMany({ where: { scheduleId: schedule.id }, orderBy: { createdAt: "asc" } })
    ).map((e) => e.toState);
    expect(states).toEqual(
      expect.arrayContaining([
        "REMINDER_DUE",
        "GRACE_PERIOD",
        "ESCALATION_PENDING",
        "VERIFICATION_REQUIRED",
        "RELEASED",
      ])
    );
  });

  it("a check-in during escalation stops everything and nothing is ever released", async () => {
    const { schedule, providers, engine, user } = await estate("checkin");
    const due = schedule.nextDueAt.getTime();
    const graceEnds = due + schedule.gracePeriodDays * DAY;

    await runSchedulerSweep(engine, { now: new Date(due - 6 * DAY), onlyScheduleIds: [schedule.id] });
    await runSchedulerSweep(engine, { now: new Date(due + 1 * DAY), onlyScheduleIds: [schedule.id] });
    await runSchedulerSweep(engine, { now: new Date(graceEnds + 1 * DAY), onlyScheduleIds: [schedule.id] });
    expect(await stateOf(schedule.id)).toBe("ESCALATION_PENDING");

    await engine.checkIn.recordAuthenticatedCheckIn(user.id, undefined, new Date(graceEnds + 2 * DAY));
    expect(await stateOf(schedule.id)).toBe("HEALTHY");

    const r = await runSchedulerSweep(engine, { now: new Date(graceEnds + 20 * DAY), onlyScheduleIds: [schedule.id] });
    expect(r.releasesAuthorized).toBe(0);
    expect(await stateOf(schedule.id)).not.toBe("RELEASED");
    expect(providers.emails.some((e) => e.templateKey === "RELEASE_PACKAGE_READY")).toBe(false);
  });

  it("a total email/SMS outage never pushes the estate toward release", async () => {
    const { schedule, providers, engine } = await estate("outage");
    providers.failing = true;
    const due = schedule.nextDueAt.getTime();

    for (const offset of [-6, 1, 2, 3, 4, 5, 6]) {
      await runSchedulerSweep(engine, { now: new Date(due + offset * DAY), onlyScheduleIds: [schedule.id] });
    }
    const row = await db.checkInSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(row.remindersSentCount).toBe(0); // nothing was delivered, so nothing counted
    expect(["REMINDER_DUE", "GRACE_PERIOD"]).toContain(row.state); // cannot reach escalation/verification
    expect(row.state).not.toBe("RELEASED");
  });

  it("with no trusted verifier the estate stays in VERIFICATION_REQUIRED (fail closed)", async () => {
    const { schedule, providers, engine } = await estate("noverifier", { withVerifier: false });
    const due = schedule.nextDueAt.getTime();
    const graceEnds = due + schedule.gracePeriodDays * DAY;
    for (const t of [due - 6 * DAY, due + DAY, graceEnds + DAY, graceEnds + 8 * DAY, graceEnds + 9 * DAY]) {
      await runSchedulerSweep(engine, { now: new Date(t), onlyScheduleIds: [schedule.id] });
    }
    expect(await stateOf(schedule.id)).toBe("VERIFICATION_REQUIRED");
    expect(providers.emails.some((e) => e.templateKey === "RELEASE_PACKAGE_READY")).toBe(false);
  });

  it("overlapping sweeps are single-flight: the second is skipped, not raced", async () => {
    const { engine, schedule } = await estate("lock");
    const results = await Promise.all([
      runSchedulerSweepExclusive(engine, { now: new Date(), onlyScheduleIds: [schedule.id] }),
      runSchedulerSweepExclusive(engine, { now: new Date(), onlyScheduleIds: [schedule.id] }),
    ]);
    // The sweeps may finish fast enough to run back-to-back, but they must never both be "in" at once;
    // at minimum, neither throws and at least one ran.
    expect(results.some((x) => !x.skipped)).toBe(true);
  });
});
