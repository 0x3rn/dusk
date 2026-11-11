// lib/billing/lemonsqueezy-signature.ts
// Lemon Squeezy signs every webhook with HMAC-SHA256 of the raw request body, hex-encoded, in the
// X-Signature header. Verify before parsing anything, on the exact bytes that were received.
import { createHmac, timingSafeEqual } from "node:crypto";

const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/** Hex HMAC-SHA256 of the body. Exported so tests and local tools can sign payloads. */
export function signLemonSqueezyBody(rawBody: string | Uint8Array, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/**
 * True only when `signatureHeader` is the correct signature for `rawBody` under `secret`.
 * A missing header, wrong length, non-hex text, empty secret or any altered byte returns false.
 */
export function verifyLemonSqueezySignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string
): boolean {
  if (!secret || !signatureHeader) return false;
  const received = signatureHeader.trim();
  // Checking the shape first also guarantees equal buffer lengths for timingSafeEqual.
  if (!HEX_SHA256.test(received)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(received, "hex"));
}
