// app/api/account/delete/route.ts
// Self-serve account deletion. GET tells the Settings card how a release stands; POST deletes the
// signed-in person's own account after a server-checked emailed code and a typed email.
// Everything the request is allowed to touch comes from the verified session, never the body.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { requireUser } from "@/lib/auth/current-user";
import { assertSameOrigin } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/body";
import { errorToResponse } from "@/lib/api/errors";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";
import {
  AccountDeletionError,
  asNeonOtpServer,
  createNeonOtpChecker,
  deleteOwnAccount,
  describeReleaseImpact,
  parseDeleteAccountInput,
} from "@/lib/account/delete-account";
import { AuthenticationError } from "@/lib/auth/security";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 4 * 1024;

export async function GET() {
  try {
    const { user } = await requireUser();
    const releaseImpact = await describeReleaseImpact(prisma, user.id);
    return NextResponse.json({ releaseImpact }, { headers: NO_STORE });
  } catch (err: unknown) {
    return errorToResponse(err, "GET /api/account/delete");
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user, identity } = await requireUser();
    // The Dusk user and the signed-in identity must be the same person. Fail closed otherwise.
    if (user.authUserId !== identity.authUserId) throw new AuthenticationError("Please sign in again.");

    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.ACCOUNT_DELETE, user.id);
    const input = parseDeleteAccountInput(await readJsonBody(req, MAX_BODY_BYTES));

    await deleteOwnAccount(
      { db: prisma, otp: createNeonOtpChecker(asNeonOtpServer(auth)) },
      { session: { authUserId: identity.authUserId, email: identity.email }, userId: user.id, input }
    );
    console.info("[account-delete] account deleted");

    // The sign-in is already gone, so every session is invalid. Also end this browser's session
    // and clear its cookies so nothing stale is left behind.
    try {
      await auth.signOut();
    } catch {
      // Nothing to sign out of any more.
    }
    const response = NextResponse.json({ ok: true }, { headers: NO_STORE });
    for (const cookie of (await cookies()).getAll()) {
      if (cookie.name.includes("neon-auth")) response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
    return response;
  } catch (err: unknown) {
    if (err instanceof AccountDeletionError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status, headers: NO_STORE });
    }
    return errorToResponse(err, "POST /api/account/delete");
  }
}
