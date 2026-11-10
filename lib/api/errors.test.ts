// lib/api/errors.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorToResponse } from "./errors";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from "../auth/security";
import { TrustBoundaryViolationError } from "../domain/trust-boundary";
import { RateLimitExceededError } from "../security/http-hardening";

afterEach(() => vi.restoreAllMocks());

describe("errorToResponse", () => {
  it.each([
    [new AuthenticationError(), 401, "UNAUTHORIZED"],
    [new AuthenticationError("verify", "EMAIL_NOT_VERIFIED"), 401, "EMAIL_NOT_VERIFIED"],
    [new AuthorizationError(), 403, "FORBIDDEN"],
    [new ValidationError("bad"), 400, "VALIDATION_ERROR"],
    [new TrustBoundaryViolationError("plaintext", "secretData"), 400, "TRUST_BOUNDARY_VIOLATION"],
  ])("maps %s to %i", async (err, status, code) => {
    const res = errorToResponse(err, "test");
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it.each([
    ["PACKAGE_GRANT_EXPIRED_OR_REVOKED", 403],
    ["RELEASE_HOLD_ACTIVE", 409],
    ["RELEASE_POLICY_NOT_SATISFIED", 409],
    ["CONCURRENCY_CONFLICT", 409],
  ])("maps the domain error code %s to %i", async (code, status) => {
    const err = Object.assign(new Error("domain problem"), { code });
    const res = errorToResponse(err, "test");
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("maps rate limiting to 429 with a Retry-After header", async () => {
    const res = errorToResponse(new RateLimitExceededError(42), "test");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect((await res.json()).code).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("returns a generic 500 and never leaks internal error text", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = errorToResponse(new Error("connection string postgres://user:secret@host"), "test");

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(spy).toHaveBeenCalledOnce();
  });
});
