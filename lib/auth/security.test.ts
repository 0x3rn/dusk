// lib/auth/security.test.ts
import { describe, expect, it } from "vitest";
import { validateEnv } from "../env";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  assertResourceOwnership,
  generateOpaqueToken,
  hashPassword,
  verifyPassword,
} from "./security";

describe("THE-97: Foundation, Auth Primitives, Env Validation & Ownership Guards", () => {
  describe("validateEnv", () => {
    it("accepts valid Neon PostgreSQL and session secret configuration", () => {
      const env = validateEnv({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:pass@ep-cool-darkness-123456.us-east-2.aws.neon.tech/dusk?sslmode=require",
        SESSION_SECRET: "a_very_long_and_secure_32_byte_session_secret_key",
      });
      expect(env.NODE_ENV).toBe("test");
      expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    });

    it("rejects missing or non-Postgres DATABASE_URL", () => {
      expect(() =>
        validateEnv({
          DATABASE_URL: "mysql://localhost:3306/db",
          SESSION_SECRET: "a_very_long_and_secure_32_byte_session_secret_key",
        })
      ).toThrowError(/DATABASE_URL must be a valid PostgreSQL connection string/);
    });

    it("rejects short SESSION_SECRET", () => {
      expect(() =>
        validateEnv({
          DATABASE_URL: "postgresql://localhost:5432/dusk",
          SESSION_SECRET: "too-short",
        })
      ).toThrowError(/SESSION_SECRET must be at least 32 characters/);
    });
  });

  describe("Password hashing & verification (Neon Postgres Auth)", () => {
    it("hashes a valid password and verifies the matching password", async () => {
      const password = "correct-horse-battery-staple-99!";
      const hash = await hashPassword(password);

      expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
      expect(hash).not.toContain(password);

      const isValid = await verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it("produces different hashes for the same password due to unique random salts", async () => {
      const password = "same-password-across-two-calls";
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it("rejects wrong passwords and malformed hash strings safely", async () => {
      const hash = await hashPassword("legitimate-password-123");
      expect(await verifyPassword("wrong-password-123", hash)).toBe(false);
      expect(await verifyPassword("legitimate-password-123", "invalid$hash")).toBe(false);
      expect(await verifyPassword("", hash)).toBe(false);
    });

    it("rejects passwords shorter than 10 characters", async () => {
      await expect(hashPassword("short123")).rejects.toThrowError(ValidationError);
    });
  });

  describe("Session & action tokens", () => {
    it("generates high-entropy opaque tokens and deterministic SHA-256 hashes", () => {
      const t1 = generateOpaqueToken();
      const t2 = generateOpaqueToken();

      expect(t1.rawToken).not.toBe(t2.rawToken);
      expect(t1.tokenHash).not.toBe(t2.tokenHash);
      expect(t1.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(t1.tokenHash).not.toBe(t1.rawToken);
    });
  });

  describe("Server-side resource ownership guard (IDOR / Horizontal Privilege Escalation)", () => {
    const vaultRecord = {
      id: "vault_1",
      userId: "user_owner_123",
      currentKeyVersion: 1,
    };

    it("returns the resource when the authenticated user is the owner", () => {
      const checked = assertResourceOwnership(vaultRecord, "user_owner_123", "Vault");
      expect(checked).toBe(vaultRecord);
    });

    it("throws AuthenticationError (401) when caller is unauthenticated", () => {
      expect(() => assertResourceOwnership(vaultRecord, null, "Vault")).toThrowError(
        AuthenticationError
      );
    });

    it("throws AuthorizationError (403) when another user attempts horizontal access", () => {
      expect(() =>
        assertResourceOwnership(vaultRecord, "user_attacker_999", "Vault")
      ).toThrowError(AuthorizationError);
    });

    it("throws AuthorizationError (403) when resource is null/missing", () => {
      expect(() =>
        assertResourceOwnership(null, "user_owner_123", "Vault")
      ).toThrowError(AuthorizationError);
    });
  });
});