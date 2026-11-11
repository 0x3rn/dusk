// lib/engine/sweep.ts
// One pass of the dead-man's-switch scheduler. Safe to run twice, late, or concurrently:
//  - every state change is keyed (idempotency key) and version-guarded in the database
//  - reminders and emails carry per-day / per-cycle keys, so a repeat sends nothing new
//  - one estate failing never stops the others, and nothing here can skip a stage
//  - release happens only through ReleaseVerificationService.authorizeEstateRelease, which
//    fails closed unless every policy rule is satisfied
import type { DetailedScheduleRecord } from "../services/checkin-schedule-service";
import { canParticipateInReleaseVerification, canReceiveReleasePackage } from "../services/contact-service";
import { ReleasePolicyNotSatisfiedError } from "../services/release-verification-service";
import type { Engine } from "./engine";
import { reminderSender } from "./engine";
import { RETENTION_MONTHS, subtractMonthsUtc } from "./retention";

const DAY_MS = 86_400_000;
const REMINDER_STATES = new Set<DetailedScheduleRecord["state"]>([
  "REMINDER_DUE",
  "GRACE_PERIOD",
  "ESCALATION_PENDING",
]);

export interface SweepReport {
  examined: number;
  transitions: Array<{ scheduleId: string; from: string; to: string }>;
  remindersSent: number;
  verifierChallengesIssued: number;
  releasesAuthorized: number;
  beneficiaryGrantsIssued: number;
  errors: Array<{ scheduleId: string; message: string }>;
}

export interface SweepOptions {
  now?: Date;
  batchSize?: number;
  /** Restrict the sweep to these schedules (tests and targeted re-runs). */
  onlyScheduleIds?: string[];
}

export async function runSchedulerSweep(
  engine: Engine,
  options: SweepOptions = {}
): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const report: SweepReport = {
    examined: 0,
    transitions: [],
    remindersSent: 0,
    verifierChallengesIssued: 0,
    releasesAuthorized: 0,
    beneficiaryGrantsIssued: 0,
    errors: [],
  };

  // Anything not settled-and-far-from-due. HEALTHY estates more than 31 days from their due date
  // need no attention yet.
  // Estates released more than the retention window ago are finished: the retention purge deletes
  // their release records, and without those records this sweep would think no beneficiary was
  // ever notified and send everyone a new link. So they are left alone here.
  const releaseWindowStart = subtractMonthsUtc(now, RETENTION_MONTHS);
  const candidates = await engine.db.checkInSchedule.findMany({
    where: {
      ...(options.onlyScheduleIds ? { id: { in: options.onlyScheduleIds } } : {}),
      state: { not: "CANCELED" },
      AND: [
        {
          OR: [
            { state: { not: "HEALTHY" } },
            { nextDueAt: { lte: new Date(now.getTime() + 31 * DAY_MS) } },
          ],
        },
        {
          OR: [
            { state: { not: "RELEASED" } },
            { releasedAt: null },
            { releasedAt: { gte: releaseWindowStart } },
          ],
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: options.batchSize ?? 50,
  });

  for (const candidate of candidates) {
    report.examined += 1;
    try {
      await processSchedule(engine, candidate, now, report);
    } catch (err) {
      // Isolate: log for operators, keep sweeping the rest.
      report.errors.push({
        scheduleId: candidate.id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }
  return report;
}

async function processSchedule(
  engine: Engine,
  candidate: DetailedScheduleRecord,
  now: Date,
  report: SweepReport
): Promise<void> {
  let schedule = candidate;

  if (schedule.state !== "RELEASED") {
    const tick = await engine.checkIn.evaluateScheduleOnTimerTick({
      scheduleId: schedule.id,
      jobIdempotencyKey: `tick:${schedule.id}:v${schedule.version}`,
      now,
      hasConfirmedReminderDelivery: schedule.remindersSentCount > 0,
    });
    if (tick.transitioned) {
      report.transitions.push({
        scheduleId: schedule.id,
        from: schedule.state,
        to: tick.schedule.state,
      });
    }
    schedule = tick.schedule;
  }

  if (REMINDER_STATES.has(schedule.state)) {
    await sendReminderOncePerDay(engine, schedule, now, report);
  }

  if (schedule.state === "VERIFICATION_REQUIRED") {
    await issueVerifierChallenges(engine, schedule, now, report);
    try {
      schedule = await engine.verification.authorizeEstateRelease(schedule.id, now);
      if (schedule.state === "RELEASED") report.releasesAuthorized += 1;
    } catch (err) {
      // "Not yet" is the normal, safe answer. Anything else is a real error.
      if (!(err instanceof ReleasePolicyNotSatisfiedError)) throw err;
    }
  }

  if (schedule.state === "RELEASED") {
    await issueBeneficiaryGrants(engine, schedule, now, report);
  }
}

async function sendReminderOncePerDay(
  engine: Engine,
  schedule: DetailedScheduleRecord,
  now: Date,
  report: SweepReport
): Promise<void> {
  const base = `reminder:${schedule.id}:${schedule.state}:${now.toISOString().slice(0, 10)}`;

  // Already finished today: don't mint another single-use link either.
  if (await engine.store.findWorkflowEventByIdempotencyKey(`${base}:DELIVERY_RECORDED`)) return;

  const user = await engine.db.user.findUnique({
    where: { id: schedule.userId },
    select: { email: true, fullName: true, phone: true },
  });
  if (!user) return;

  const { rawCheckInToken } = await engine.checkIn.issueSingleUseCheckInToken(schedule.userId, now);
  const sender = reminderSender(engine.providers, {
    actionUrl: `${engine.appUrl.replace(/\/$/, "")}/checkin/${rawCheckInToken}`,
    recipientName: user.fullName,
    appUrl: engine.appUrl,
    escalated: schedule.state !== "REMINDER_DUE",
  });

  const result = await engine.escalation(sender).dispatchStageReminderWithFallback({
    userId: schedule.userId,
    userEmail: user.email,
    userPhone: user.phone,
    idempotencyBaseKey: base,
    now,
  });
  if (result.anyDelivered) report.remindersSent += 1;
}

async function issueVerifierChallenges(
  engine: Engine,
  schedule: DetailedScheduleRecord,
  now: Date,
  report: SweepReport
): Promise<void> {
  const verifiers = (
    await engine.db.contact.findMany({ where: { userId: schedule.userId, isTrustedVerifier: true } })
  ).filter(canParticipateInReleaseVerification);
  if (verifiers.length === 0) return;

  const events = await engine.store.listReleaseEventsByScheduleId(schedule.id);
  const { generateOpaqueToken } = await import("../auth/security");

  for (const contact of verifiers) {
    // One live challenge per verifier per cycle (since the owner's last check-in).
    const alreadyChallenged = events.some(
      (e) =>
        e.eventType === "VERIFIER_CHALLENGE_ISSUED" &&
        e.contactId === contact.id &&
        e.createdAt.getTime() >= schedule.lastCheckInAt.getTime()
    );
    if (alreadyChallenged) continue;

    const { rawToken, tokenHash } = generateOpaqueToken();
    const expiresAt = new Date(now.getTime() + 14 * DAY_MS);
    const challenge = await engine.store.createReleaseEvent({
      scheduleId: schedule.id,
      userId: schedule.userId,
      contactId: contact.id,
      eventType: "VERIFIER_CHALLENGE_ISSUED",
      actionTokenHash: tokenHash,
      tokenExpiresAt: expiresAt,
      metadataJson: JSON.stringify({ expiresAtIso: expiresAt.toISOString() }),
    });

    const sent = await engine.notifier.sendNotificationWithFallback(
      {
        userId: schedule.userId,
        templateKey: "TRUSTED_VERIFIER_CHALLENGE",
        primaryEmail: contact.email,
        fallbackPhone: contact.phone,
        idempotencyKey: `verifier-challenge:${challenge.id}`,
        templateVariables: {
          actionUrl: `${engine.appUrl.replace(/\/$/, "")}/verify/${rawToken}`,
          recipientName: contact.fullName,
        },
      },
      now
    );
    if (sent.delivered) report.verifierChallengesIssued += 1;
  }
}

async function issueBeneficiaryGrants(
  engine: Engine,
  schedule: DetailedScheduleRecord,
  now: Date,
  report: SweepReport
): Promise<void> {
  const beneficiaries = (
    await engine.db.contact.findMany({ where: { userId: schedule.userId, isBeneficiary: true } })
  ).filter(canReceiveReleasePackage);

  const events = await engine.store.listReleaseEventsByScheduleId(schedule.id);

  for (const contact of beneficiaries) {
    const alreadyGranted = events.some(
      (e) => e.eventType === "BENEFICIARY_ACCESS_GRANT_ISSUED" && e.contactId === contact.id
    );
    if (alreadyGranted) continue;

    const grant = await engine.verification.issueBeneficiaryAccessGrant({
      scheduleId: schedule.id,
      contactId: contact.id,
      now,
    });
    const sent = await engine.notifier.sendNotificationWithFallback(
      {
        userId: schedule.userId,
        templateKey: "RELEASE_PACKAGE_READY",
        primaryEmail: contact.email,
        fallbackPhone: contact.phone,
        idempotencyKey: `release-package:${grant.grantEvent.id}`,
        templateVariables: {
          actionUrl: `${engine.appUrl.replace(/\/$/, "")}/unlock/${contact.id}?token=${grant.rawAccessToken}`,
          recipientName: contact.fullName,
        },
      },
      now
    );
    if (sent.delivered) report.beneficiaryGrantsIssued += 1;
  }
}

const SCHEDULER_LOCK_KEY = 727_274; // arbitrary constant: "dusk scheduler"

/**
 * Single-flight guard: if another sweep is already running (overlapping cron, a retry, a
 * double-click on "run now"), this one is skipped instead of racing it. The lock is a
 * transaction-scoped Postgres advisory lock, released automatically if the process dies.
 */
export async function runSchedulerSweepExclusive(
  engine: Engine,
  options: SweepOptions = {}
): Promise<{ skipped: true } | { skipped: false; report: SweepReport }> {
  return engine.db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_KEY}) AS locked`;
      if (!rows[0]?.locked) return { skipped: true as const };
      const report = await runSchedulerSweep(engine, options);
      return { skipped: false as const, report };
    },
    { maxWait: 5_000, timeout: 120_000 }
  );
}
