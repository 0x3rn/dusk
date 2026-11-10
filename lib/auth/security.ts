// lib/auth/security.ts
import crypto from "node:crypto";

export class ValidationError extends Error {
  public readonly code = "VALIDATION_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends Error {
  public readonly code = "FORBIDDEN";
  public readonly statusCode = 403;
  constructor(message = "You do not have permission to access this resource.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class AuthenticationError extends Error {
  public readonly statusCode = 401;
  constructor(
    message = "Authentication required.",
    public readonly code: "UNAUTHORIZED" | "EMAIL_NOT_VERIFIED" | "IDENTITY_CONFLICT" = "UNAUTHORIZED"
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Generates a high-entropy opaque session or invitation token and its SHA-256 hash.
 * Only `tokenHash` is persisted in PostgreSQL; `rawToken` is sent to the user cookie/link.
 */
export function generateOpaqueToken(byteLength = 32): {
  rawToken: string;
  tokenHash: string;
} {
  const rawToken = crypto.randomBytes(byteLength).toString("base64url");
  const tokenHash = hashOpaqueToken(rawToken);
  return { rawToken, tokenHash };
}

export function hashOpaqueToken(rawToken: string): string {
  if (!rawToken || rawToken.trim().length === 0) {
    throw new ValidationError("Token cannot be empty.");
  }
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Hashes an IP address with a salt so we can detect suspicious logins
 * without storing raw user IP addresses in plaintext.
 */
export function hashIpAddress(ip: string, salt = "dusk-ip-telemetry-v1"): string {
  return crypto.createHmac("sha256", salt).update(ip).digest("hex").slice(0, 32);
}

/**
 * Enforces server-side resource ownership (THE-97).
 * Prevents horizontal privilege escalation (IDOR) across all protected resources.
 */
export function assertResourceOwnership<T extends { userId: string }>(
  resource: T | null | undefined,
  authenticatedUserId: string | null | undefined,
  resourceName = "Resource"
): T {
  if (!authenticatedUserId) {
    throw new AuthenticationError();
  }
  if (!resource) {
    throw new AuthorizationError(`${resourceName} not found or access denied.`);
  }
  if (resource.userId !== authenticatedUserId) {
    // Same message as "missing" so a caller cannot tell another user's id from one that does not
    // exist, and the caller's own account id is never echoed back.
    throw new AuthorizationError(`${resourceName} not found or access denied.`);
  }
  return resource;
}