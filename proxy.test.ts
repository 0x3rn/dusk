// proxy.test.ts
// Tests the proxy composition with a stand-in for the Neon Auth proxy, which behaves the same way
// the real one does: it copies the incoming request headers when it allows a request through and
// redirects signed-out visitors.
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signedIn = { value: true };

vi.mock("@/lib/auth/server", () => ({
  auth: {
    middleware: () => async (request: NextRequest) => {
      if (!signedIn.value) return NextResponse.redirect(new URL("/login", request.url));
      return NextResponse.next({ request: { headers: new Headers(request.headers) } });
    },
  },
}));

import proxy, { config, isDashboardPath } from "./proxy";

function overriddenRequestHeaders(response: NextResponse): Map<string, string> {
  const names = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
  const out = new Map<string, string>();
  for (const name of names) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value !== null) out.set(name, value);
  }
  return out;
}

function nonceOf(policy: string): string {
  const match = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy);
  if (!match) throw new Error("no nonce in policy");
  return match[1];
}

describe("proxy", () => {
  beforeEach(() => {
    signedIn.value = true;
  });

  it("puts a nonce CSP on the response and passes the same nonce to the app", async () => {
    const response = await proxy(new NextRequest("http://localhost:3204/help"));
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).toContain("script-src 'self' 'nonce-");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);

    const forwarded = overriddenRequestHeaders(response);
    expect(forwarded.get("x-nonce")).toBe(nonceOf(policy));
    expect(forwarded.get("content-security-policy")).toBe(policy);
  });

  it("uses a fresh nonce for every request", async () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 25; i += 1) {
      const response = await proxy(new NextRequest("http://localhost:3204/"));
      nonces.add(nonceOf(response.headers.get("Content-Security-Policy") ?? ""));
    }
    expect(nonces.size).toBe(25);
  });

  it("ignores a nonce or policy sent by the client", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3204/", {
        headers: { "x-nonce": "attackerchosennonce==", "content-security-policy": "script-src *" },
      })
    );
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    const forwarded = overriddenRequestHeaders(response);
    expect(forwarded.get("x-nonce")).not.toBe("attackerchosennonce==");
    expect(forwarded.get("x-nonce")).toBe(nonceOf(policy));
    expect(forwarded.get("content-security-policy")).toBe(policy);
  });

  it("lets a signed-in visitor through to /dashboard with the CSP applied", async () => {
    const response = await proxy(new NextRequest("http://localhost:3204/dashboard/contacts"));
    expect(response.status).toBe(200);
    const policy = response.headers.get("Content-Security-Policy") ?? "";
    expect(policy).toContain("'strict-dynamic'");
    expect(overriddenRequestHeaders(response).get("x-nonce")).toBe(nonceOf(policy));
  });

  it("still redirects a signed-out visitor from /dashboard to /login", async () => {
    signedIn.value = false;
    const response = await proxy(new NextRequest("http://localhost:3204/dashboard"));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/login");
  });

  it("does not gate public pages on a session", async () => {
    signedIn.value = false;
    for (const path of ["/", "/login", "/register", "/help", "/privacy", "/terms", "/security", "/unlock/abc", "/checkin/abc", "/verify/abc"]) {
      const response = await proxy(new NextRequest(`http://localhost:3204${path}`));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("Content-Security-Policy"), path).toContain("nonce-");
    }
  });
});

describe("isDashboardPath", () => {
  it("matches the dashboard and its sub-paths only", () => {
    expect(isDashboardPath("/dashboard")).toBe(true);
    expect(isDashboardPath("/dashboard/settings")).toBe(true);
    expect(isDashboardPath("/dashboardx")).toBe(false);
    expect(isDashboardPath("/help/dashboard")).toBe(false);
  });
});

describe("matcher", () => {
  const [source] = config.matcher;
  const regex = new RegExp(`^${source}$`);
  it("covers pages and excludes static assets and API routes", () => {
    for (const path of ["/", "/login", "/dashboard", "/dashboard/x", "/unlock/abc", "/security/disclosures", "/not-a-page"]) {
      expect(regex.test(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/a.js", "/_next/image", "/favicon.ico", "/icon.svg", "/logo.svg", "/api/vault", "/api"]) {
      expect(regex.test(path), path).toBe(false);
    }
  });
});
