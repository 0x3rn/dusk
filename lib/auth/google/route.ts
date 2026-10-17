// app/api/auth/google/route.ts
import { NextResponse } from "next/server";
import {
  getFoundationService,
  setSessionCookie,
} from "@/lib/auth/session-cookie";
import { ValidationError } from "@/lib/services/foundation-service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    const service = getFoundationService();
    const result = await service.authenticateWithGoogle({
      ...body,
      userAgent,
      ipAddress: forwardedFor,
    });

    await setSessionCookie(result.sessionToken);

    return NextResponse.json(
      {
        user: result.user,
        schedule: result.schedule,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("[POST /api/auth/google]", err);
    return NextResponse.json(
      { error: "Unable to synchronize Google account." },
      { status: 500 }
    );
  }
}