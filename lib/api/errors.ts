// lib/api/errors.ts
// One place that turns thrown domain errors into HTTP responses, so every route fails the same
// way and no internal error text leaks to clients.
import { NextResponse } from "next/server";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from "../auth/security";
import { TrustBoundaryViolationError } from "../domain/trust-boundary";
import { RateLimitExceededError } from "../security/http-hardening";
import { scrubText } from "../observability/sentry-scrub";

export interface ApiErrorBody {
  error: string;
  code: string;
}

/** Domain errors that carry a stable `code`: mapped by code so this file stays decoupled from each service. */
const DOMAIN_ERROR_STATUS: Record<string, number> = {
  PACKAGE_GRANT_EXPIRED_OR_REVOKED: 403,
  RELEASE_HOLD_ACTIVE: 409,
  RELEASE_POLICY_NOT_SATISFIED: 409,
  CONCURRENCY_CONFLICT: 409,
  CRITICAL_CONTACT_CHANGE_CONFIRMATION_REQUIRED: 409,
  RECOVERY_ARTIFACT_REVOKED: 403,
};

export function errorToResponse(err: unknown, routeLabel: string): NextResponse<ApiErrorBody> {
  if (err instanceof AuthenticationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 401 });
  }
  if (err instanceof AuthorizationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 403 });
  }
  if (err instanceof ValidationError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
  }
  if (err instanceof TrustBoundaryViolationError) {
    return NextResponse.json(
      { error: err.message, code: "TRUST_BOUNDARY_VIOLATION" },
      { status: 400 }
    );
  }
  if (err instanceof RateLimitExceededError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
    );
  }
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code in DOMAIN_ERROR_STATUS) {
      return NextResponse.json({ error: err.message, code }, { status: DOMAIN_ERROR_STATUS[code] });
    }
  }
  // Unexpected: log the detail server-side, return a generic message.
  // Database errors echo the failing query's arguments (emails, ciphertext), so scrub before logging.
  console.error(`[${routeLabel}]`, scrubText(err instanceof Error ? err.stack ?? err.message : String(err)));
  return NextResponse.json(
    { error: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" },
    { status: 500 }
  );
}
