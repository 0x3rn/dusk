// app/api/vault/route.ts
import { NextResponse } from "next/server";
import { getFoundationService, requireUser } from "@/lib/auth/current-user";
import { errorToResponse } from "@/lib/api/errors";
import { assertSameOrigin } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/body";
import { prisma } from "@/lib/db";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user } = await requireUser();
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.DASHBOARD_MUTATION, user.id);
    const body = await readJsonBody(req);
    const vault = await getFoundationService().createEmptyVault(user.id, body);

    return NextResponse.json({ vault }, { status: 201 });
  } catch (err: unknown) {
    return errorToResponse(err, "POST /api/vault");
  }
}
