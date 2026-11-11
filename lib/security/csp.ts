// lib/security/csp.ts
// Per-request, nonce-based Content Security Policy. Pure functions (no Next imports) so they can
// be unit tested; proxy.ts wires them into every page request.
//
// Why a nonce: a static policy had to allow `script-src 'unsafe-inline'`, which lets any injected
// inline <script> run. With a fresh random nonce per response, the browser runs only scripts that
// carry that nonce (the ones Next.js renders) and, through 'strict-dynamic', the scripts those
// load. An attacker who can inject HTML cannot guess the nonce.

/** Request header carrying the nonce from the proxy to server components (see app/layout.tsx). */
export const CSP_NONCE_HEADER = "x-nonce";

/** Sentry ingest hosts for browser error reporting (all regions). */
const SENTRY_INGEST_HOSTS = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
] as const;

/** 128 bits of CSPRNG output, base64 encoded (24 characters). */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export interface ContentSecurityPolicyOptions {
  nonce: string;
  /** Development needs 'unsafe-eval' (React debugging) and has no HTTPS upgrade. */
  isDevelopment: boolean;
}

// Base64 alphabet only: a nonce containing a quote, space, semicolon or comma could break out of
// the directive and inject another source expression, so anything else is refused outright.
const NONCE_PATTERN = /^[A-Za-z0-9+/]{16,}={0,2}$/;

export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
}: ContentSecurityPolicyOptions): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("CSP nonce must be base64 text of at least 16 characters.");
  }

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // The vault key derivation (Argon2id) runs as WebAssembly in the browser.
    "'wasm-unsafe-eval'",
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    // Styles stay as before so the look is unchanged: React/Framer Motion set inline style
    // attributes, which a style nonce cannot cover. Script execution is the critical control.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://images.unsplash.com https://*.googleusercontent.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' ${SENTRY_INGEST_HOSTS.join(" ")}`,
    "frame-src 'self'",
    // Key derivation runs in a same-origin Web Worker (lib/crypto/kdf.worker.ts). Without this
    // directive worker-src falls back to script-src, where 'strict-dynamic' makes browsers ignore
    // 'self' and block the worker. Only same-origin worker scripts are allowed: no blob:, data:
    // or remote hosts.
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isDevelopment ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}

/**
 * Policy sent with the build's static scripts (served from /_next/static, which the proxy does
 * not cover). A browser applies the policy of a Web Worker's own script to that worker, so this
 * confines the key-derivation worker, which handles passphrase bytes: it may load more of its own
 * code and compile WebAssembly, and it may not make any network request or open anything else.
 * On ordinary script files the header is ignored.
 */
export const WORKER_SCRIPT_CSP =
  "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; base-uri 'none'; form-action 'none'";
