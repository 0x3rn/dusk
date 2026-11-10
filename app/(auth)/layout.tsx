// app/(auth)/layout.tsx
import { redirect } from "next/navigation";
import { isSignedIn } from "@/lib/auth/current-user";

// Reads the signed-in session, so it must render per request, never at build time.
export const dynamic = "force-dynamic";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (await isSignedIn()) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
