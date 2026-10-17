// lib/auth/session-cookie.ts
import { cookies } from "next/headers";
import { prisma } from "../db";
import { FoundationService } from "../services/foundation-service";
import { PrismaFoundationStore } from "../services/prisma-foundation-store";

export const DUSK_SESSION_COOKIE = "dusk_session";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

export function getFoundationService(): FoundationService {
  return new FoundationService(new PrismaFoundationStore(prisma));
}

export async function setSessionCookie(rawToken: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(DUSK_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: THIRTY_DAYS_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(DUSK_SESSION_COOKIE);
}

export async function getSessionTokenFromRequest(req?: Request): Promise<string | null> {
  if (req) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
  }
  const cookieStore = await cookies();
  return cookieStore.get(DUSK_SESSION_COOKIE)?.value ?? null;
}