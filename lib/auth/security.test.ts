// lib/auth/security.test.ts
import { describe, expect, it } from "vitest";
import { validateEnv } from "../env";
import {
  AuthenticationError,
  AuthorizationError,
  assertResourceOwnership,
  generateOpaqueToken,
} from "./security";

describe("THE-97: Foundation, Auth Primitives, Env Validation & Ownership Guards", () => {
  describe("validateEnv", () => {
    const valid = {
      NODE_ENV: "test",
      DATABASE_URL:
        "postgresql://user:pass@ep-cool-darkness-123456.us-east-2.aws.neon.tech/dusk?sslmode=require",
      NEON_AUTH_BASE_URL: "https://ep-cool-darkness-123456.neonauth.us-east-2.aws.neon.tech/neondb/auth",
      NEON_AUTH_COOKIE_SECRET: "a_very_long_and_secure_32_byte_cookie_secret_key",
    };

    it("accepts a valid Neon PostgreSQL and Neon Auth configuration", () => {
      const env = validateEnv(valid);
      expect(env.NODE_ENV).toBe("test");
      expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
      expect(env.LEMONSQUEEZY_API_KEY).toBeUndefined();
    });

    it("treats blank optional provider keys as unset", () => {
      const env = validateEnv({ ...valid, RESEND_API_KEY: "   ", LEMONSQUEEZY_API_KEY: "" });
      expect(env.RESEND_API_KEY).toBeUndefined();
      expect(env.LEMONSQUEEZY_API_KEY).toBeUndefined();
    });

    it("rejects missing or non-Postgres DATABASE_URL", () => {
      expect(() =>
        validateEnv({ ...valid, DATABASE_URL: "mysql://localhost:3306/db" })
      ).toThrowError(/DATABASE_URL must be a valid PostgreSQL connection string/);
      expect(() => validateEnv({ ...valid, DATABASE_URL: undefined })).toThrowError(
        /DATABASE_URL/
      );
    });

    it("rejects a short NEON_AUTH_COOKIE_SECRET", () => {
      expect(() => validateEnv({ ...valid, NEON_AUTH_COOKIE_SECRET: "too-short" })).toThrowError(
        /NEON_AUTH_COOKIE_SECRET must be at least 32 characters/
      );
    });

    it("rejects a missing or malformed NEON_AUTH_BASE_URL", () => {
      expect(() => validateEnv({ ...valid, NEON_AUTH_BASE_URL: undefined })).toThrowError(
        /NEON_AUTH_BASE_URL/
      );
      expect(() => validateEnv({ ...valid, NEON_AUTH_BASE_URL: "not a url" })).toThrowError(
        /NEON_AUTH_BASE_URL/
      );
    });

    it("rejects a short CRON_SECRET when one is provided", () => {
      expect(() => validateEnv({ ...valid, CRON_SECRET: "short" })).toThrowError(/CRON_SECRET/);
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

    it("gives the same message for another user's resource as for a missing one, without echoing ids", () => {
      const foreign = () => assertResourceOwnership(vaultRecord, "user_attacker_999", "Vault");
      const missing = () => assertResourceOwnership(null, "user_attacker_999", "Vault");
      expect(foreign).toThrowError("Vault not found or access denied.");
      expect(missing).toThrowError("Vault not found or access denied.");
      expect(foreign).not.toThrowError(/user_attacker_999|user_owner_123/);
    });

    it("throws AuthorizationError (403) when resource is null/missing", () => {
      expect(() =>
        assertResourceOwnership(null, "user_owner_123", "Vault")
      ).toThrowError(AuthorizationError);
    });
  });
});