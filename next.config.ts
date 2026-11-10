// next.config.ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { getProductionSecurityHeaders } from "./lib/security/http-hardening";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: getProductionSecurityHeaders(),
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
