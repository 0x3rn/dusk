// lib/api/invite-answer.ts
// Shared handler for the two public invitation answers (accept, decline). The invitee has no
// account: the single-use link token is the only credential, so this runs rate limiting, a
// same-origin check and strict body validation before touching the database.
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/auth/security";
import { assertSameOrigin } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/body";
import { errorToResponse } from "@/lib/api/errors";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/security/db-rate-limiter";
import { ContactService, InvitationLinkError } from "@/lib/services/contact-service";
import { PrismaContactStore } from "@/lib/services/prisma-contact-store";

const BodySchema = z.object({ token: z.string().min(16).max(200) });

/** Small body: a token and nothing else. */
const MAX_BODY_BYTES = 2 * 1024;

export async function answerInvitation(req: Request, answer: "accept" | "decline", routeLabel: string) {
  try {
    assertSameOrigin(req);
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.INVITE_LINK, clientKeyFromRequest(req));

    const parsed = BodySchema.safeParse(await readJsonBody(req, MAX_BODY_BYTES));
    if (!parsed.success) throw new ValidationError("This invitation link is not valid.");

    const store = new PrismaContactStore(prisma);
    const service = new ContactService(store);
    const input = { rawInviteToken: parsed.data.token };
    const contact =
      answer === "accept"
        ? await service.acceptContactInvitation(input)
        : await service.declineContactInvitation(input);

    // Say only what the person needs: who asked and for what. Never the owner's email or anyone else.
    return NextResponse.json({
      ok: true,
      outcome: answer === "accept" ? "accepted" : "declined",
      ownerName: await store.findOwnerDisplayName(contact.userId),
      isBeneficiary: contact.isBeneficiary,
      isTrustedVerifier: contact.isTrustedVerifier,
    });
  } catch (err) {
    if (err instanceof InvitationLinkError) {
      return NextResponse.json(
        {
          error:
            err.reason === "EXPIRED"
              ? "This invitation has expired. Ask the person who invited you to send a new one."
              : "This invitation link isn't valid. It may have been used already, or the person may have cancelled it.",
          code: err.reason === "EXPIRED" ? "INVITATION_EXPIRED" : "INVITATION_INVALID",
        },
        { status: err.reason === "EXPIRED" ? 410 : 404 }
      );
    }
    return errorToResponse(err, routeLabel);
  }
}
