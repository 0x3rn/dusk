// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import {
  getFoundationService,
  setSessionCookie,
} from "@/lib/auth/session-cookie";
import {
  AuthenticationError,
  ValidationError,
} from "@/lib/services/foundation-service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    const service = getFoundationService();
    const result = await service.loginWithPassword({
      ...body,
      userAgent,
      ipAddress: forwardedFor,
    });

    await setSessionCookie(result.sessionToken);

    return NextResponse.json({ user: result.user }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof AuthenticationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    console.error("[POST /api/auth/login]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unable to sign in." },
      { status: 500 }
    );
  }
}