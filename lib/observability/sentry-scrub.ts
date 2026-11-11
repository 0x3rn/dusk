// lib/observability/sentry-scrub.ts
// Removes anything sensitive from an error event BEFORE it leaves our servers or browsers.
// Dusk is zero-knowledge: error reports must never carry request bodies (encrypted vault data,
// wrapped keys), cookies/auth headers, emails, or the single-use tokens in /checkin, /verify and
// /unlock links.

/**
 * Page paths whose segment holds a secret. The lookbehind skips our own API routes
 * (/api/checkin/confirm, /api/verify), which carry no token in the path.
 */
const TOKEN_PATH_PATTERNS: Array<[RegExp, string]> = [
  [/(?<!\/api)(\/checkin\/)[^/?#]+/g, "$1[redacted]"],
  [/(?<!\/api)(\/verify\/)[^/?#]+/g, "$1[redacted]"],
  [/(?<!\/api)(\/unlock\/)[^/?#]+/g, "$1[redacted]"],
  [/(?<!\/api)(\/invite\/)[^/?#]+/g, "$1[redacted]"],
];

/** Drops the query string and fragment, and hides token path segments. */
export function scrubUrl(url: string): string {
  let out = url.split("#")[0].split("?")[0];
  for (const [pattern, replacement] of TOKEN_PATH_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Free text (error messages, log lines, span descriptions) can carry things the structured
 * scrubbing above never sees: Prisma error messages echo the query arguments (emails, ciphertext),
 * and URLs inside messages can hold single-use tokens. Hide emails and any long token-like run.
 */
export function scrubText(text: string): string {
  return text
    .replace(/https?:\/\/[^\s"'<>)]+/g, (url) => scrubUrl(url))
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g, "[email]")
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, "[redacted]");
}

function scrubStringsDeep(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map((v) => scrubStringsDeep(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrubStringsDeep(v, depth + 1);
    return out;
  }
  return value;
}

interface ScrubbableEvent {
  request?: {
    url?: string;
    query_string?: unknown;
    data?: unknown;
    cookies?: unknown;
    headers?: unknown;
    [key: string]: unknown;
  };
  user?: Record<string, unknown>;
  breadcrumbs?: Array<{ data?: Record<string, unknown>; message?: string; [key: string]: unknown }>;
  transaction?: string;
  message?: string;
  logentry?: { message?: string; params?: unknown };
  exception?: {
    values?: Array<{
      value?: string;
      stacktrace?: { frames?: Array<Record<string, unknown>> };
      [key: string]: unknown;
    }>;
  };
  spans?: Array<{ description?: string; data?: Record<string, unknown>; [key: string]: unknown }>;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Scrubs an event in place and returns it. Generic over the SDK's own event types so it can be
 * used directly as beforeSend / beforeSendTransaction.
 */
export function scrubSentryEvent<T extends object>(input: T): T {
  const event = input as unknown as ScrubbableEvent;
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (typeof event.request.url === "string") {
      event.request.url = scrubUrl(event.request.url);
    }
  }

  // Only an opaque account id may identify a user: no email, no IP.
  if (event.user) {
    const id = event.user.id;
    event.user = typeof id === "string" ? { id } : {};
  }

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data) {
        for (const key of ["url", "from", "to"]) {
          const v = crumb.data[key];
          if (typeof v === "string") crumb.data[key] = scrubUrl(v);
        }
        delete crumb.data.request_body;
        delete crumb.data.response_body;
      }
      if (typeof crumb.message === "string") crumb.message = scrubText(scrubUrl(crumb.message));
    }
  }

  if (typeof event.message === "string") event.message = scrubText(event.message);
  if (event.logentry) {
    if (typeof event.logentry.message === "string") event.logentry.message = scrubText(event.logentry.message);
    delete event.logentry.params;
  }
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = scrubText(ex.value);
    // Local variables captured with stack frames can hold request data.
    for (const frame of ex.stacktrace?.frames ?? []) delete frame.vars;
  }
  for (const span of event.spans ?? []) {
    if (typeof span.description === "string") span.description = scrubText(span.description);
    if (span.data) span.data = scrubStringsDeep(span.data) as Record<string, unknown>;
  }
  if (event.contexts) event.contexts = scrubStringsDeep(event.contexts) as Record<string, unknown>;

  if (typeof event.transaction === "string") {
    event.transaction = scrubUrl(event.transaction);
  }
  delete event.extra;

  return input;
}
