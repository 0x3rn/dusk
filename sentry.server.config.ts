// sentry.server.config.ts
// Error reporting for server code. Does nothing unless SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/observability/sentry-scrub";

// This setup is built for Node. Inside a Cloudflare Worker it is unverified and could misbehave, so
// it is skipped there until Worker error reporting is set up and tested (see docs/CLOUDFLARE.md).
const isCloudflareWorker = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

if (!isCloudflareWorker) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || undefined,
    enabled: Boolean(process.env.SENTRY_DSN),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
  });
}
