// proxy.ts
// Next.js 16 proxy (formerly middleware). Redirects signed-out visitors away from the dashboard
// and refreshes the Neon Auth session. API routes do their own 401 handling and are not matched.
import { auth } from "@/lib/auth/server";

export default auth.middleware({
  loginUrl: "/login",
});

export const config = {
  matcher: ["/dashboard/:path*"],
};
