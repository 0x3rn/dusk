// tests/integration/engine-store.int.test.ts
// Proves the dead-man's-switch guarantees against REAL Postgres, not in-memory fakes:
// optimistic concurrency, idempotent scheduler ticks, single-use tokens, no direct RELEASED.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { PrismaEngineStore } from "@/lib/services/prisma-engine-store";
import {
  CheckInScheduleService,
  ConcurrencyConflictError,
} from "@/lib/services/checkin-schedule-service";
import { AuthorizationError } from "@/lib/auth/security";

const store = new PrismaEngineStore(db);
const service = new CheckInScheduleService(store);
const DAY = 86_400_000;

const created: string[] = [];
async function newUser(label: string) {
  const t = await createTestUser(label);
  created.push(t.user.id);
  return t;
}

afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

describe("PrismaEngineStore against Postgres", () => {
  beforeAll(async () => {
    await db.$queryRaw`SELECT 1`;
  });

  it("an authenticated check-in is idempotent: the same key applies once", async () => {
    const { user, schedule } = await newUser("checkin");
    const a = await service.recordAuthenticatedCheckIn(user.id, "key-1");
    const b = await service.recordAuthenticatedCheckIn(user.id, "key-1");

    expect(b.workflowEvent.id).toBe(a.workflowEvent.id);
    const after = await db.checkInSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(after.version).toBe(schedule.version + 1);
    expect(await db.workflowEvent.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it("two simultaneous writers at the same version: exactly one wins, the other gets a conflict", async () => {
    const { schedule } = await newUser("race");
    const attempt = (key: string) =>
      store.updateScheduleWithVersionCheck({
        scheduleId: schedule.id,
        expectedVersion: schedule.version,
        data: { remindersSentCount: 1 },
        event: {
          userId: schedule.userId,
          fromState: "HEALTHY",
          toState: "HEALTHY",
          reason: "RACE_TEST",
          idempotencyKey: key,
          actorType: "SYSTEM_SCHEDULER",
          actorId: null,
        },
      });

    const results = await Promise.allSettled([attempt("race-a"), attempt("race-b")]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflictError);
    expect(await db.workflowEvent.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it("a duplicate scheduler job with the same key transitions only once", async () => {
    const { schedule } = await newUser("tick");
    const lateNow = new Date(schedule.nextDueAt.getTime() - 1 * DAY); // inside the reminder window
    const job = { scheduleId: schedule.id, jobIdempotencyKey: "tick-1", now: lateNow };

    const first = await service.evaluateScheduleOnTimerTick(job);
    const second = await service.evaluateScheduleOnTimerTick(job);

    expect(first.transitioned).toBe(true);
    expect(first.schedule.state).toBe("REMINDER_DUE");
    expect(second.transitioned).toBe(false);
    expect(await db.workflowEvent.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it("scheduler ticks advance one stage at a time and can NEVER reach RELEASED", async () => {
    const { schedule } = await newUser("never-released");
    const farFuture = new Date(schedule.nextDueAt.getTime() + 3650 * DAY);
    const seen: string[] = [];

    for (let i = 0; i < 12; i++) {
      const r = await service.evaluateScheduleOnTimerTick({
        scheduleId: schedule.id,
        jobIdempotencyKey: `never-${i}`,
        now: farFuture,
        hasConfirmedReminderDelivery: true,
      });
      seen.push(r.schedule.state);
    }

    expect(seen).not.toContain("RELEASED");
    const final = await db.checkInSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(final.state).not.toBe("RELEASED");
    expect(final.releasedAt).toBeNull();
  });

  it("a single-use check-in link works once; a simultaneous second click is refused", async () => {
    const { user } = await newUser("link");
    const { rawCheckInToken } = await service.issueSingleUseCheckInToken(user.id);

    const results = await Promise.allSettled([
      service.confirmCheckInWithSingleUseToken(rawCheckInToken),
      service.confirmCheckInWithSingleUseToken(rawCheckInToken),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AuthorizationError);

    await expect(service.confirmCheckInWithSingleUseToken(rawCheckInToken)).rejects.toBeInstanceOf(
      AuthorizationError
    );
  });

  it("an unknown check-in token is refused", async () => {
    await expect(
      service.confirmCheckInWithSingleUseToken("not-a-real-token-value")
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});
