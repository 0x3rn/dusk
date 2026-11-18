// lib/security/static-headers.test.ts
// public/_headers is what Cloudflare applies to static files. It must carry the same locked-down
// policy for the key-derivation Web Worker script that next.config.ts sets on other hosts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_SCRIPT_CSP } from "./csp";

const text = readFileSync(path.resolve(import.meta.dirname, "../../public/_headers"), "utf8");

/** Headers listed under one path rule in a Cloudflare _headers file. */
function headersFor(rule: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === rule);
  if (start === -1) throw new Error(`No "${rule}" rule in public/_headers`);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break;
    const [name, ...value] = line.trim().split(":");
    headers[name.toLowerCase()] = value.join(":").trim();
  }
  return headers;
}

describe("public/_headers for /_next/static/*", () => {
  const headers = headersFor("/_next/static/*");

  it("uses exactly the worker-script CSP from lib/security/csp.ts", () => {
    expect(headers["content-security-policy"]).toBe(WORKER_SCRIPT_CSP);
  });

  it("caches built files for a year as immutable", () => {
    expect(headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("stops browsers guessing file types", () => {
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });
});
