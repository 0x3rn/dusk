// lib/auth/errors.ts
// Error classes with no Node-only imports, so code that also runs in the browser (for example the
// settings page via lib/security/http-hardening.ts) can use them without pulling in `node:crypto`.
// lib/auth/security.ts re-exports them, so existing imports keep working.

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
