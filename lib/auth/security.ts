// lib/auth/security.ts
import crypto from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N = 2^14
const SCRYPT_BLOCK_SIZE = 8; // r = 8
const SCRYPT_PARALLELIZATION = 1; // p = 1
const MIN_PASSWORD_LENGTH = 10;

function deriveScryptKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) {
        reject(err);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

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
  public readonly code = "UNAUTHORIZED";
  public readonly statusCode = 401;
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/**
 * Hashes a user password for Neon PostgreSQL authentication.
 * Note: Per THE-96, this authentication password hash is strictly for server login
 * and is NEVER used as a vault encryption key.
 */
export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
    );
  }

  const salt = crypto.randomBytes(16);
  const derivedKey = await deriveScryptKey(
    password.normalize("NFKC"),
    salt,
    SCRYPT_KEYLEN,
    {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    }
  );

  return [
    "scrypt",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

/**
 * Verifies a plaintext password against a stored scrypt hash using constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  if (!password || !storedHash) {
    return false;
  }

  const parts = storedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expectedKey = Buffer.from(parts[5], "base64");

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization) ||
    salt.byteLength < 16 ||
    expectedKey.byteLength !== SCRYPT_KEYLEN
  ) {
    return false;
  }

  const derivedKey = await deriveScryptKey(
    password.normalize("NFKC"),
    salt,
    expectedKey.byteLength,
    {
      N: cost,
      r: blockSize,
      p: parallelization,
    }
  );

  if (derivedKey.byteLength !== expectedKey.byteLength) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedKey);
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
    throw new AuthorizationError(
      `Horizontal privilege escalation blocked: caller ${authenticatedUserId} does not own ${resourceName}.`
    );
  }
  return resource;
}