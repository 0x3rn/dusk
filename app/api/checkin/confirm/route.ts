// app/api/checkin/confirm/route.ts
// One-click "I'm okay" from a reminder email. Authenticated by the single-use token alone.
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { createEngine } from "@/lib/engine/engine";
import { ValidationError } from "@/lib/auth/security";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/security/db-rate-limiter";

const BodySchema = z.object({ token: z.string().min(20).max(200) });

export async function POST(req: Request) {
  try {
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.CHECKIN_LINK, clientKeyFromRequest(req));

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("This check-in link is not valid.");

    const { schedule } = await createEngine().checkIn.confirmCheckInWithSingleUseToken(
      parsed.data.token
    );
    // Say only what the person needs; never echo account details to an emailed link.
    return NextResponse.json({ ok: true, nextDueAt: schedule.nextDueAt.toISOString() });
  } catch (err) {
    return errorToResponse(err, "POST /api/checkin/confirm");
  }
}
