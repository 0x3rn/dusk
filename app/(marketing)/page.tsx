// app/(marketing)/page.tsx
import {
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";
import { MarketingLanding } from "./marketing-landing";

export default async function MarketingPage() {
  const token = await getSessionTokenFromRequest();
  let isAuthenticated = false;

  if (token) {
    try {
      const service = getFoundationService();
      await service.authenticateSession(token);
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  return <MarketingLanding initialIsAuthenticated={isAuthenticated} />;
}
