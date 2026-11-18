// lib/auth/server.ts
// Neon Auth (Managed Better Auth) server instance. Neon hosts the auth server and stores users
// and sessions in the neon_auth schema of our own database; this app only proxies to it.
import { createNeonAuth } from "@neon/auth/next/server";
import { getServerEnv } from "../env";
import { lazyInstance } from "../lazy-instance";

type NeonAuth = ReturnType<typeof createNeonAuth>;

let instance: NeonAuth | undefined;

// Built on first use, not when this file is imported. The settings come from secrets that a build
// does not have (a clean CI checkout, Cloudflare's builder), and every route that imports this file
// is loaded during the build.
function getAuth(): NeonAuth {
  if (!instance) {
    const env = getServerEnv();
    instance = createNeonAuth({
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
  }
  return instance;
}

export const auth: NeonAuth = lazyInstance(getAuth);
