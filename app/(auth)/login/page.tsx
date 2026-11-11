"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { authErrorMessage } from "@/lib/auth/client-errors";
import { Notice } from "@/components/ui/notice";
import { CheckoutIntentBanner, IntentLink } from "@/components/billing/checkout-intent-banner";
import { afterSignInPath } from "@/lib/billing/checkout-client";
import { AuthHeader } from "@/components/auth/auth-header";
import { GoogleButton, OrDivider } from "@/components/auth/social-sign-in";
import { authInputClass } from "@/components/auth/auth-field-classes";
import { buttonPrimaryClass, fieldLabelClass } from "@/components/ui/form-field";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw result.error;
      router.push(afterSignInPath(window.location.search));
      router.refresh();
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't sign you in. Check your connection and try again."));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (loading) return;
    setError("");
    setLoading(true);
    try {
      // Redirects to Google and back; the page unloads, so loading stays true on success.
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: afterSignInPath(window.location.search),
      });
      if (result?.error) throw result.error;
    } catch (err: unknown) {
      setError(authErrorMessage(err, "We couldn't sign you in with Google. Try again, or use your email and password."));
      setLoading(false);
    }
  };

  return (
    <>
      <AuthHeader title="Welcome back" intro="Sign in to your Dusk account." />

      <CheckoutIntentBanner mode="login" />

      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}

      <GoogleButton onClick={handleGoogleSignIn} disabled={loading} />

      <OrDivider />

      <form onSubmit={handleLogin} className="space-y-5">
        <div>
          <label htmlFor="login-email" className={fieldLabelClass}>
            Email
          </label>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInputClass}
            placeholder="you@example.com"
          />
        </div>
        <div>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="login-password" className={`${fieldLabelClass} mb-0`}>
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-sm text-accent-text underline underline-offset-2 font-medium inline-flex min-h-11 items-center -my-1.5"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInputClass}
          />
        </div>

        <button type="submit" disabled={loading} className={`${buttonPrimaryClass} w-full`}>
          <Lock strokeWidth={1.75} className="w-4 h-4" aria-hidden="true" />
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>

      <div className="mt-8 space-y-1 text-center text-sm text-foreground-secondary">
        <p>
          Don&apos;t have an account?{" "}
          <IntentLink to="/register" className="text-accent-text underline underline-offset-2 font-medium inline-flex min-h-11 items-center">
            Create one
          </IntentLink>
        </p>
        <p>
          Locked out of your vault?{" "}
          <Link href="/recovery" className="text-accent-text underline underline-offset-2 font-medium">
            Read the recovery guide
          </Link>
        </p>
      </div>
    </>
  );
}
