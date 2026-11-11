// proxy.ts
// Next.js 16 proxy (formerly middleware). It does two jobs on page requests:
//  1. Sets a per-request nonce Content-Security-Policy (see lib/security/csp.ts) and hands the
//     nonce to Next.js, which stamps it on its own scripts while rendering.
//  2. Redirects signed-out visitors away from /dashboard and refreshes the Neon Auth session
//     (unchanged behaviour, still only for /dashboard).
// API routes are not matched: they return JSON, do their own 401 handling and get their
// cache headers from next.config.ts.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/server";
import { CSP_NONCE_HEADER, buildContentSecurityPolicy, generateCspNonce } from "@/lib/security/csp";

const authProxy = auth.middleware({
  loginUrl: "/login",
});

export function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = generateCspNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    isDevelopment: process.env.NODE_ENV === "development",
  });

  // Headers are always overwritten, so a client cannot choose its own nonce or policy.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  let response: NextResponse;
  if (isDashboardPath(request.nextUrl.pathname)) {
    // The auth proxy copies the incoming request headers when it lets a request through, so the
    // nonce and policy travel with it. A redirect for a signed-out visitor is returned as is.
    response = await authProxy(new NextRequest(request, { headers: requestHeaders }));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    // Every page request, except API routes and static assets (files with an image extension,
    // Next.js build output and the favicon), which have no HTML to protect.
    "/((?!api(?:/|$)|_next/static|_next/image|favicon\.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
