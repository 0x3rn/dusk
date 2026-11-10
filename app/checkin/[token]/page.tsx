"use client";

import { use, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";

type Status = "idle" | "working" | "done" | "error";

export default function CheckInLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // The link only shows a button. Checking in happens on click (a POST), never on page load,
  // so email scanners that open links cannot use up your single-use link.
  const confirm = async () => {
    if (status === "working") return;
    setStatus("working");
    setMessage("");
    try {
      const res = await fetch("/api/checkin/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "We couldn't check you in.");
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "We couldn't check you in.");
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-8 shadow-sm text-center">
        {status === "done" ? (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-brand" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              You&apos;re checked in
            </h1>
            <p className="text-sm text-foreground-secondary mb-6">
              Thank you. Any reminders have stopped and your next check-in date has been reset.
            </p>
            <Link href="/dashboard" className="text-sm text-accent-text hover:underline font-medium">
              Go to your dashboard
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              Confirm you&apos;re okay
            </h1>
            <p className="text-sm text-foreground-secondary mb-6">
              One click tells Dusk you&apos;re fine. It stops reminders and resets your schedule.
            </p>
            {status === "error" && (
              <p
                role="alert"
                className="mb-4 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-fg)] text-[var(--danger-fg)] text-sm"
              >
                {message}
              </p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={status === "working"}
              className="w-full bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors p-3 rounded-lg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {status === "working" ? "Checking in..." : "I'm okay, check me in"}
            </button>
            <p className="mt-6 text-xs text-foreground-muted">
              This link works once. If it has expired, sign in to your dashboard and check in there.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
