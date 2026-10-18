// app/(auth)/layout.tsx
import { redirect } from "next/navigation";
import {
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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

  if (isAuthenticated) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}