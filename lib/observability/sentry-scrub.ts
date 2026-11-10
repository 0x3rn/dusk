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
];

/** Drops the query string and fragment, and hides token path segments. */
export function scrubUrl(url: string): string {
  let out = url.split("#")[0].split("?")[0];
  for (const [pattern, replacement] of TOKEN_PATH_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
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
      if (typeof crumb.message === "string") crumb.message = scrubUrl(crumb.message);
    }
  }

  if (typeof event.transaction === "string") {
    event.transaction = scrubUrl(event.transaction);
  }
  delete event.extra;

  return input;
}
