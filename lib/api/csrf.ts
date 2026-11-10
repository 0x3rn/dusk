// lib/api/csrf.ts
// Same-origin guard for state-changing API routes. Browsers attach session cookies automatically,
// so every mutation must prove it came from our own site: the Origin header must match the Host
// the request was addressed to, and the browser must not report it as cross-site.
import { assertCsrfSafeMutationRequest } from "../security/http-hardening";

export function assertSameOrigin(req: Request): void {
  assertCsrfSafeMutationRequest({
    method: req.method,
    originHeader: req.headers.get("origin"),
    hostHeader: req.headers.get("host"),
    secFetchSiteHeader: req.headers.get("sec-fetch-site"),
  });
}
