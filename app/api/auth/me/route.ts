// app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import {
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";

export async function GET(req: Request) {
  try {
    const token = await getSessionTokenFromRequest(req);
    if (!token) {
      return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
    }
    const service = getFoundationService();
    const { user } = await service.authenticateSession(token);
    return NextResponse.json({ authenticated: true, user }, { status: 200 });
  } catch {
    return NextResponse.json({ authenticated: false, user: null }, { status: 200 });
  }
}