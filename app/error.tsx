"use client";

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";

import { DuskLogo } from "@/components/landing/dusk-logo";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui/form-field";

// Shown instead of the framework's raw error screen when a page fails while it is running.
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <main className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
          Something went wrong
        </h1>
        <p className="text-sm text-foreground-secondary mb-6">
          This page didn&apos;t load. Your vault and settings are safe. Try again, or go back to the home page.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button type="button" onClick={() => unstable_retry()} className={buttonPrimaryClass}>
            Try again
          </button>
          <Link href="/" className={buttonSecondaryClass}>
            Go to home page
          </Link>
        </div>
        {error.digest && (
          <p className="mt-6 text-xs text-foreground-secondary">
            If you contact support, mention this reference: <span className="font-mono">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}
