// lib/auth/server.ts
// Neon Auth (Managed Better Auth) server instance. Neon hosts the auth server and stores users
// and sessions in the neon_auth schema of our own database; this app only proxies to it.
import { createNeonAuth } from "@neon/auth/next/server";
import { getServerEnv } from "../env";

const env = getServerEnv();

export const auth = createNeonAuth({
  baseUrl: env.NEON_AUTH_BASE_URL,
  cookies: {
    secret: env.NEON_AUTH_COOKIE_SECRET,
    // The SDK caches session data in a signed cookie (default 5 minutes) and would keep serving a
    // REVOKED session for that long. Dusk guards a vault, so a revoked device must lose access
    // within about a second: the SDK rejects 0, so use the smallest allowed value (1 second).
    // Raise this only if the extra round trip to Neon Auth becomes a problem.
    sessionDataTtl: 1,
  },
});
