"use client";

import { use, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { Notice } from "@/components/ui/notice";
import { buttonPrimaryClass, fieldLabelClass, fieldTextareaClass } from "@/components/ui/form-field";

type Action = "ALIVE" | "HOLD" | "APPROVE";
type Status = "idle" | "working" | "done" | "error";

const OPTIONS: Array<{ value: Action; title: string; help: string }> = [
  {
    value: "ALIVE",
    title: "I know they are alive",
    help: "This stops the process and puts everything back to normal.",
  },
  {
    value: "HOLD",
    title: "Something is wrong: pause everything",
    help: "Use this if you are unsure, or you think this is a mistake.",
  },
  {
    value: "APPROVE",
    title: "I confirm they have died or cannot act",
    help: "Only choose this if you actually know. It moves the process toward release.",
  },
];

export default function VerifierPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [action, setAction] = useState<Action | null>(null);
  const [statement, setStatement] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!action || status === "working") return;
    setStatus("working");
    setMessage("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, statement }),
      });
      const data = await res.json();
      if (!res.ok) {
        const invalid = /token|invalid|expired|already used/i.test(String(data.error ?? ""));
        throw new Error(
          invalid
            ? "This link isn't valid. It may have expired or already been used."
            : data.error || "We couldn't record your answer. Try again in a moment."
        );
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "We couldn't record your answer. Try again in a moment.");
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-lg border border-border bg-card rounded-2xl p-8 shadow-sm">
        {status === "done" ? (
          <div className="text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-4 text-accent-text" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">Thank you</h1>
            <p className="text-sm text-foreground-secondary">
              Your answer was recorded. You don&apos;t need to do anything else.
            </p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-2xl font-bold tracking-tight text-foreground mb-2">
              Trusted verifier
            </h1>
            <p className="text-sm text-foreground-secondary mb-6">
              Someone named you as a person they trust. They have missed their Dusk check-ins.
              Please answer honestly. Only choose what you actually know.
            </p>

            {status === "error" && (
              <p
                role="alert"
                className="mb-4 p-3 rounded-lg bg-[var(--danger-bg)] border border-[var(--danger-fg)] text-[var(--danger-fg)] text-sm"
              >
                {message}
              </p>
            )}

            <fieldset className="space-y-3 mb-6">
              <legend className="sr-only">Your answer</legend>
              {OPTIONS.map((o) => (
                <label
                  key={o.value}
                  className={`flex gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                    action === o.value ? "border-accent-text bg-accent-surface/40" : "border-border hover:bg-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="action"
                    value={o.value}
                    checked={action === o.value}
                    onChange={() => setAction(o.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-medium text-foreground">{o.title}</span>
                    <span className="block text-sm text-foreground-secondary">{o.help}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <label htmlFor="verify-statement" className={fieldLabelClass}>
              In a sentence, how do you know?
            </label>
            <textarea
              id="verify-statement"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              className={fieldTextareaClass}
                          />

                          {action === "APPROVE" && (
                            <Notice tone="error" className="mt-4">
                              You are about to confirm that this person has died or cannot act. This moves their plan toward
                              release and can&apos;t be undone from this page. If you are not sure, choose &quot;pause everything&quot;
                              instead.
                            </Notice>
                          )}

            <button
              type="submit"
              disabled={!action || status === "working"}
              className={`${buttonPrimaryClass} w-full mt-6`}
                          >
                            {status === "working" ? "Sending..." : action === "APPROVE" ? "Yes, I'm sure. Send my answer" : "Send my answer"}
            </button>
            <p className="mt-4 text-sm text-foreground-secondary">This link works once.</p>
          </form>
        )}
      </div>
    </main>
  );
}
