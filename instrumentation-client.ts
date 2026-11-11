// instrumentation-client.ts
// Browser error reporting. Does nothing unless NEXT_PUBLIC_SENTRY_DSN is set. Session replay is
// deliberately NOT enabled: it would record the screen of a vault.
import * as Sentry from "@sentry/nextjs";
import { config as configureZod } from "zod/v4/core";
import { scrubSentryEvent } from "./lib/observability/sentry-scrub";

// Zod normally compiles schemas with `new Function`, which our Content-Security-Policy (no
// 'unsafe-eval') blocks and reports as a violation on every page that loads the sign-in client.
// Zod falls back to plain interpretation on its own, so turn the attempt off. This runs before
// the app, so it applies to the copy of Zod bundled with the auth client too.
configureZod({ jitless: true });

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  tracesSampleRate: 0.1,
  beforeSend: (event) => scrubSentryEvent(event),
  beforeSendTransaction: (event) => scrubSentryEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
