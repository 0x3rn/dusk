// lib/billing/lemonsqueezy-signature.test.ts
import { describe, expect, it } from "vitest";
import { signLemonSqueezyBody, verifyLemonSqueezySignature } from "./lemonsqueezy-signature";

const SECRET = "whsec_test_secret_123";
const BODY = JSON.stringify({ meta: { event_name: "order_created" }, data: { id: "1" } });

describe("verifyLemonSqueezySignature", () => {
  it("matches the documented scheme: lowercase hex HMAC-SHA256 of the raw body", () => {
    // Independent known-answer vector, computed with openssl:
    //   echo -n hello | openssl dgst -sha256 -hmac secret
    expect(signLemonSqueezyBody("hello", "secret")).toBe(
      "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b"
    );
  });

  it("accepts the correct signature", () => {
    expect(verifyLemonSqueezySignature(BODY, signLemonSqueezyBody(BODY, SECRET), SECRET)).toBe(true);
  });

  it("accepts the same bytes as a Uint8Array and an uppercase hex header", () => {
    const sig = signLemonSqueezyBody(BODY, SECRET);
    expect(verifyLemonSqueezySignature(new TextEncoder().encode(BODY), sig.toUpperCase(), SECRET)).toBe(true);
  });

  it("rejects a body changed by even one byte", () => {
    const sig = signLemonSqueezyBody(BODY, SECRET);
    expect(verifyLemonSqueezySignature(BODY.replace('"1"', '"2"'), sig, SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(`${BODY} `, sig, SECRET)).toBe(false);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifyLemonSqueezySignature(BODY, signLemonSqueezyBody(BODY, "another-secret"), SECRET)).toBe(false);
  });

  it("rejects a missing or empty header", () => {
    expect(verifyLemonSqueezySignature(BODY, null, SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(BODY, undefined, SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(BODY, "", SECRET)).toBe(false);
  });

  it("rejects headers of the wrong length or that are not hex, without throwing", () => {
    const sig = signLemonSqueezyBody(BODY, SECRET);
    expect(verifyLemonSqueezySignature(BODY, sig.slice(0, 63), SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(BODY, `${sig}0`, SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(BODY, "z".repeat(64), SECRET)).toBe(false);
    expect(verifyLemonSqueezySignature(BODY, `sha256=${sig}`, SECRET)).toBe(false);
  });

  it("never accepts anything when the secret is empty", () => {
    expect(verifyLemonSqueezySignature(BODY, signLemonSqueezyBody(BODY, ""), "")).toBe(false);
  });
});
