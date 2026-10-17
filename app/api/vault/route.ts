// app/api/vault/route.ts
import { NextResponse } from "next/server";
import {
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";
import {
  AuthenticationError,
  AuthorizationError,
  TrustBoundaryViolationError,
  ValidationError,
} from "@/lib/services/foundation-service";

export async function POST(req: Request) {
  try {
    const token = await getSessionTokenFromRequest(req);
    const service = getFoundationService();
    const { user } = await service.authenticateSession(token);

    const body = await req.json();
    const vault = await service.createEmptyVault(user.id, body);

    return NextResponse.json({ vault }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
    }
    if (err instanceof TrustBoundaryViolationError || err instanceof ValidationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    console.error("[POST /api/vault]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}