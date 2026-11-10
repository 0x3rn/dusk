// lib/auth/current-user.ts
// The only place that connects a Neon Auth session to a Dusk user. Server-only.
import { prisma } from "../db";
import { FoundationService, type UserRecord } from "../services/foundation-service";
import { PrismaFoundationStore } from "../services/prisma-foundation-store";
import { AuthenticationError } from "./security";
import { parseNeonSession, type ParsedNeonSession } from "./neon-session";
import { auth } from "./server";

export function getFoundationService(): FoundationService {
  return new FoundationService(new PrismaFoundationStore(prisma));
}

export interface CurrentUser {
  user: UserRecord;
  authSession: ParsedNeonSession["authSession"];
}

/** The signed-in Dusk user, or null when signed out. Throws only for broken/suspended sessions. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const { data, error } = await auth.getSession();
  if (error) {
    throw new AuthenticationError("Could not verify your session. Please sign in again.");
  }
  const parsed = parseNeonSession(data);
  if (!parsed) return null;

  const user = await getFoundationService().resolveUserFromIdentity(parsed.identity);
  return { user, authSession: parsed.authSession };
}

/** Like getCurrentUser, but throws AuthenticationError when nobody is signed in. */
export async function requireUser(): Promise<CurrentUser> {
  const current = await getCurrentUser();
  if (!current) throw new AuthenticationError();
  return current;
}

/** Cheap "is anyone signed in?" check for public pages. Never creates a Dusk user. */
export async function isSignedIn(): Promise<boolean> {
  try {
    const { data } = await auth.getSession();
    return parseNeonSession(data) !== null;
  } catch {
    return false;
  }
}
