// app/api/verify/route.ts
// A trusted verifier answers their challenge email: "they are alive", "place a hold", or
// "I confirm they have died". The emailed single-use token is the only credential, so it is
// consumed atomically before anything else happens, and the response reveals nothing about the
// estate owner.
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { createEngine } from "@/lib/engine/engine";
import { AuthorizationError, ValidationError, hashOpaqueToken } from "@/lib/auth/security";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/security/db-rate-limiter";

const BodySchema = z.object({
  token: z.string().min(20).max(200),
  action: z.enum(["APPROVE", "ALIVE", "HOLD"]),
  statement: z.string().trim().min(5).max(500),
});

export async function POST(req: Request) {
  try {
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.VERIFIER_LINK, clientKeyFromRequest(req));

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      throw new ValidationError("Please choose an answer and add a short statement (5+ characters).");
    }
    const { token, action, statement } = parsed.data;
    const now = new Date();
    const engine = createEngine();

    const challenge = await engine.store.findReleaseEventByTokenHash(hashOpaqueToken(token));
    if (
      !challenge ||
      challenge.eventType !== "VERIFIER_CHALLENGE_ISSUED" ||
      !challenge.contactId ||
      challenge.tokenUsedAt !== null ||
      !challenge.tokenExpiresAt ||
      challenge.tokenExpiresAt.getTime() <= now.getTime()
    ) {
      throw new AuthorizationError("This verifier link is not valid, has expired, or was already used.");
    }

    // Atomic single-use: of two simultaneous submissions, exactly one proceeds.
    await engine.store.markReleaseEventTokenUsed(challenge.id, now);

    const common = { scheduleId: challenge.scheduleId, contactId: challenge.contactId };
    if (action === "APPROVE") {
      await engine.verification.submitVerifierReleaseApproval(
        { ...common, verificationStatement: statement },
        now
      );
    } else if (action === "ALIVE") {
      await engine.escalation().signalUserAliveByTrustedContact(
        { ...common, attestationNote: statement },
        now
      );
    } else {
      await engine.verification.placeReleaseHold(
        {
          scheduleId: challenge.scheduleId,
          actorType: "TRUSTED_CONTACT",
          actorId: challenge.contactId,
          holdReason: statement,
        },
        now
      );
    }

    return NextResponse.json({ ok: true, action });
  } catch (err) {
    return errorToResponse(err, "POST /api/verify");
  }
}
