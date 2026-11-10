// lib/auth/neon-session.ts
// Pure parsing of the session object returned by Neon Auth. Kept free of Next.js and env imports
// so it can be tested without a running server.
import { z } from "zod";
import { AuthenticationError } from "./security";

const NeonSessionSchema = z.object({
  session: z.object({
    id: z.string().min(1),
    expiresAt: z.coerce.date(),
    ipAddress: z.string().nullish(),
    userAgent: z.string().nullish(),
    createdAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
  }),
  user: z.object({
    id: z.string().min(1),
    email: z.string().email(),
    emailVerified: z.boolean(),
    name: z.string().nullish(),
    banned: z.boolean().nullish(),
  }),
});

export interface ParsedNeonSession {
  identity: {
    authUserId: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
  };
  authSession: {
    id: string;
    expiresAt: Date;
    ipAddress: string | null;
    userAgent: string | null;
  };
}

/**
 * Turns the raw `auth.getSession()` data into a typed identity.
 * Returns null when there is no session. Throws AuthenticationError for an expired or banned
 * session, or for a payload that does not match the expected shape (fail closed).
 */
export function parseNeonSession(raw: unknown, now = new Date()): ParsedNeonSession | null {
  if (raw === null || raw === undefined) return null;

  const parsed = NeonSessionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AuthenticationError("Unrecognised session from the authentication provider.");
  }
  const { session, user } = parsed.data;

  if (user.banned) {
    throw new AuthenticationError("This account is suspended.");
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    throw new AuthenticationError("Session has expired.");
  }

  return {
    identity: {
      authUserId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name ?? null,
    },
    authSession: {
      id: session.id,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress ?? null,
      userAgent: session.userAgent ?? null,
    },
  };
}
