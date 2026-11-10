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
      return NextResponse.json({ ok: true, skipped: true });
    }
    const { report } = result;
    if (report.errors.length > 0) {
      console.error("[scheduler] sweep finished with errors", {
        count: report.errors.length,
        // schedule ids only; never message bodies or personal data
        scheduleIds: report.errors.map((e) => e.scheduleId),
      });
    }
    return NextResponse.json({
      ok: true,
      skipped: false,
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
