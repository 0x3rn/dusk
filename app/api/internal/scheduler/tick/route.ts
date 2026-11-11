// app/api/internal/scheduler/tick/route.ts
// Called by the durable scheduler (Trigger.dev) every few minutes. Not a user endpoint:
// it is authenticated by a shared secret and returns counts only (no personal data).
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import { createEngine } from "@/lib/engine/engine";
import { runSchedulerSweepExclusive } from "@/lib/engine/sweep";
import { runRetentionPurge } from "@/lib/engine/retention";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function secretMatches(provided: string, expected: string): boolean {
  // Hash both so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Deletes data past its promised retention. A purge problem must never stop reminders or releases,
 * so any error is logged (class name only, no row data) and reported as `failed`. Counts only.
 */
async function runRetentionIsolated() {
  try {
    const result = await runRetentionPurge(prisma);
    if (result.skipped) return { skipped: true as const };
    console.info("[retention] purge finished", { ...result.counts, capped: result.capped });
    return { skipped: false as const, failed: false as const, counts: result.counts, capped: result.capped };
  } catch (err) {
    console.error("[retention] purge failed", { error: err instanceof Error ? err.name : "UnknownError" });
    return { skipped: false as const, failed: true as const };
  }
}

export async function POST(req: Request) {
  const expected = getServerEnv().CRON_SECRET;
  if (!expected) {
    console.error("[POST /api/internal/scheduler/tick] CRON_SECRET is not configured.");
    return NextResponse.json({ error: "Scheduler is not configured." }, { status: 503 });
  }

  const header = req.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.SCHEDULER_TICK, "global");
    const result = await runSchedulerSweepExclusive(createEngine());
    if (result.skipped) {
      // Another sweep is running. The purge has its own lock, so it can still go ahead.
      return NextResponse.json({ ok: true, skipped: true, retention: await runRetentionIsolated() });
    }
    const { report } = result;
    if (report.errors.length > 0) {
      console.error("[scheduler] sweep finished with errors", {
        count: report.errors.length,
        // schedule ids only; never message bodies or personal data
        scheduleIds: report.errors.map((e) => e.scheduleId),
      });
    }
    const retention = await runRetentionIsolated();
    return NextResponse.json({
      ok: true,
      skipped: false,
      retention,
      examined: report.examined,
      transitions: report.transitions.length,
      remindersSent: report.remindersSent,
      verifierChallengesIssued: report.verifierChallengesIssued,
      releasesAuthorized: report.releasesAuthorized,
      beneficiaryGrantsIssued: report.beneficiaryGrantsIssued,
      errors: report.errors.length,
    });
  } catch (err) {
    return errorToResponse(err, "POST /api/internal/scheduler/tick");
  }
}
