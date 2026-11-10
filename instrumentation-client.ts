// instrumentation-client.ts
// Browser error reporting. Does nothing unless NEXT_PUBLIC_SENTRY_DSN is set. Session replay is
// deliberately NOT enabled: it would record the screen of a vault.
import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "./lib/observability/sentry-scrub";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
