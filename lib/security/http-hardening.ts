// lib/security/http-hardening.ts
import { AuthorizationError } from "../auth/security";

/**
 * THE-111: Production Security Headers, CSRF Protection, Rate Limits & Legal Disclaimers
 *
 * Critical Security Details:
 * 1. `Referrer-Policy: no-referrer` is mandatory for Dusk so browser navigation from
 *    `/unlock/[contactId]#privateKey` can NEVER leak URL metadata in Referer headers.
 * 2. `frame-ancestors 'none'` and `X-Frame-Options: DENY` prevent clickjacking on
 *    vault unlock, beneficiary assignment, and release verification screens.
 * 3. `assertCsrfSafeMutationRequest` blocks cross-site state mutations.
 * 4. `SlidingWindowRateLimiter` protects login, recovery, and beneficiary unlock routes
 *    against brute-force and replay enumeration.
 */

export interface SecurityHeaderEntry {
  key: string;
  value: string;
}

export function getProductionSecurityHeaders(): SecurityHeaderEntry[] {
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://apis.google.com https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://images.unsplash.com https://*.googleusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://api.stripe.com",
    "frame-src 'self' https://*.firebaseapp.com https://js.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: cspDirectives },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    },
    { key: "X-DNS-Prefetch-Control", value: "off" },
  ];
}

export class CsrfViolationError extends AuthorizationError {
  public readonly csrfReason: string;
  constructor(reason: string) {
    super(`CSRF protection blocked request: ${reason}`);
    this.name = "CsrfViolationError";
    this.csrfReason = reason;
  }
}

/**
 * Verifies that a state-mutating HTTP request (`POST`, `PUT`, `PATCH`, `DELETE`)
 * originates from the expected host/origin and is not a cross-site forgery.
 */
export function assertCsrfSafeMutationRequest(params: {
  method: string;
  originHeader?: string | null;
  hostHeader?: string | null;
  secFetchSiteHeader?: string | null;
  allowedOrigins?: string[];
}): void {
  const method = params.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }

  if (params.secFetchSiteHeader === "cross-site") {
    throw new CsrfViolationError("CROSS_SITE_FETCH_REJECTED");
  }

  if (!params.originHeader) {
    throw new CsrfViolationError("MISSING_ORIGIN_HEADER_ON_MUTATION");
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(params.originHeader);
  } catch {
    throw new CsrfViolationError("MALFORMED_ORIGIN_HEADER");
  }

  if (params.allowedOrigins && params.allowedOrigins.length > 0) {
    const allowedSet = new Set(
      params.allowedOrigins.map((o) => o.replace(/\/$/, "").toLowerCase())
    );
    if (!allowedSet.has(parsedOrigin.origin.toLowerCase())) {
      throw new CsrfViolationError("ORIGIN_NOT_IN_ALLOWLIST");
    }
    return;
  }

  if (params.hostHeader) {
    if (parsedOrigin.host.toLowerCase() !== params.hostHeader.toLowerCase()) {
      throw new CsrfViolationError("ORIGIN_HOST_MISMATCH");
    }
  }
}

export class RateLimitExceededError extends Error {
  public readonly code = "RATE_LIMIT_EXCEEDED";
  public readonly statusCode = 429;
  public readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(
      `Too many requests. Please wait ${retryAfterSeconds} seconds before retrying.`
    );
    this.name = "RateLimitExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface RateLimitPolicy {
  bucketName: string;
  maxAttempts: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES = {
  AUTH_LOGIN: {
    bucketName: "auth_login",
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 5 attempts per 15 minutes
  },
  RECOVERY_UNLOCK: {
    bucketName: "recovery_unlock",
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000, // 3 attempts per hour
  },
  BENEFICIARY_PACKAGE_ACCESS: {
    bucketName: "beneficiary_access",
    maxAttempts: 5,
    windowMs: 30 * 60 * 1000, // 5 attempts per 30 minutes
  },
} as const satisfies Record<string, RateLimitPolicy>;

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  /**
   * Checks and records a rate-limited action for `(policy, subjectKey)` at `nowMs`.
   * Throws `RateLimitExceededError` if `maxAttempts` within `windowMs` is exceeded.
   */
  consume(
    policy: RateLimitPolicy,
    subjectKey: string,
    nowMs = Date.now()
  ): { remainingAttempts: number } {
    const key = `${policy.bucketName}:${subjectKey.trim().toLowerCase()}`;
    const windowStartMs = nowMs - policy.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter(
      (ts) => ts > windowStartMs
    );

    if (timestamps.length >= policy.maxAttempts) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = Math.max(
        1000,
        oldestInWindow + policy.windowMs - nowMs
      );
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
      this.buckets.set(key, timestamps);
      throw new RateLimitExceededError(retryAfterSeconds);
    }

    timestamps.push(nowMs);
    this.buckets.set(key, timestamps);

    return {
      remainingAttempts: Math.max(0, policy.maxAttempts - timestamps.length),
    };
  }

  reset(policy: RateLimitPolicy, subjectKey: string): void {
    const key = `${policy.bucketName}:${subjectKey.trim().toLowerCase()}`;
    this.buckets.delete(key);
  }
}

export const LEGAL_SCOPE_AND_ESTATE_DISCLAIMER = {
  version: "2026-10-01",
  notALegalWillHeadline:
    "Dusk is a cryptographic digital-estate delivery system, NOT a legal will, trust, or substitute for statutory estate planning.",
  zeroKnowledgeCustodyNotice:
    "Dusk operates on a strict zero-knowledge architecture. Dusk Technologies never possesses your Master Passphrase, Vault Master Key, or offline Recovery Kit, and cannot decrypt your vault under any circumstances—including lost credentials or legal compulsion.",
  estatePlanningGuidance:
    "Transferring technical access to accounts, cryptographic keys, or instructions does not automatically transfer legal title or ownership under applicable probate or inheritance laws. Consult a qualified estate-planning attorney in your jurisdiction to execute a valid Last Will and Testament or Living Trust.",
} as const;