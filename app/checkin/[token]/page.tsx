"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { buttonPrimaryClass } from "@/components/ui/form-field";

type Status = "idle" | "working" | "done" | "error";

export default function CheckInLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const doneHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // Move focus to the result so keyboard and screen reader users hear that it worked.
  useEffect(() => {
    if (status === "done") doneHeadingRef.current?.focus();
  }, [status]);

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
      if (!res.ok) {
        // "token" is developer wording; tell the person what it means for them.
        const invalid = /token|invalid|expired|already used/i.test(String(data.error ?? ""));
        throw new Error(
          invalid
            ? "This link isn't valid. It may have expired or already been used."
            : data.error || "We couldn't check you in. Try again in a moment."
        );
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "We couldn't check you in. Try again in a moment.");
    }
  };

  return (
    <main className="min-h-dvh bg-canvas flex flex-col items-center justify-center px-4 py-8 sm:p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-5 sm:p-8 shadow-sm text-center">
        {status === "done" ? (
          <>
            <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-accent-text" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2" tabIndex={-1} ref={doneHeadingRef}>
                          You&apos;re checked in
                        </h1>
            <p className="text-sm text-foreground-secondary mb-6">
              Thank you. Reminders have stopped and your next check-in date has been reset.
            </p>
            <Link href="/dashboard" className="text-sm text-accent-text font-medium underline underline-offset-2 inline-flex min-h-11 items-center">
              Go to your dashboard
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              Confirm you&apos;re okay
            </h1>
            <p className="text-sm text-foreground-secondary mb-6">
              One click tells Dusk you&apos;re okay. It stops reminders and restarts your check-in schedule.
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
              className={`${buttonPrimaryClass} w-full`}
            >
              {status === "working" ? "Checking in..." : "I'm okay, check me in"}
            </button>
            <p className="mt-6 text-sm text-foreground-secondary">
                          This link works once. If it has expired,{" "}
                          <Link href="/login" className="text-accent-text underline underline-offset-2">
                            sign in
                          </Link>{" "}
                          and check in from your dashboard.
                        </p>
          </>
        )}
      </div>
    </main>
  );
}
