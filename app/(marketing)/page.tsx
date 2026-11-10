// app/(marketing)/page.tsx
import { isSignedIn } from "@/lib/auth/current-user";
import { MarketingLanding } from "./marketing-landing";

// Reads the signed-in session, so it must render per request, never at build time.
export const dynamic = "force-dynamic";

export default async function MarketingPage() {
  return <MarketingLanding initialIsAuthenticated={await isSignedIn()} />;
}
