// sentry.server.config.ts
// Error reporting for server code. Does nothing unless SENTRY_DSN is set.
import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/observability/sentry-scrub";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
});
