// next.config.ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { WORKER_SCRIPT_CSP } from "./lib/security/csp";
import { getProductionSecurityHeaders } from "./lib/security/http-hardening";

const nextConfig: NextConfig = {
  // Do not advertise the framework in an X-Powered-By header.
  poweredByHeader: false,
  // Inside a Cloudflare Worker the Postgres driver opens connections through pg-cloudflare. Next only
  // traces the plain-Node variant of that package, so the Worker variant is included on purpose.
  outputFileTracingIncludes: {
    "/*": ["./node_modules/pg-cloudflare/**/*"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: getProductionSecurityHeaders(),
      },
      ...(process.env.NODE_ENV === "production"
        ? [
            {
              // The key-derivation Web Worker is a static script (the proxy does not cover it):
              // its own policy keeps it off the network. See WORKER_SCRIPT_CSP.
              source: "/_next/static/:path*",
              headers: [{ key: "Content-Security-Policy", value: WORKER_SCRIPT_CSP }],
            },
          ]
        : []),
      {
        // The invitation page names the person who invited you and its link is a credential.
        source: "/invite/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        // API responses hold personal and encrypted data: never let a browser or CDN reuse them.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Source-map upload only happens when SENTRY_AUTH_TOKEN (plus org and project) is set in CI.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
});
