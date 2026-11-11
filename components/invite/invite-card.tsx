"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Link2Off, ShieldCheck, TimerReset } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { Notice } from "@/components/ui/notice";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui/form-field";
import {
  UNNAMED_OWNER,
  acceptMeaning,
  roleExplanations,
  roleSummary,
  type InvitationRoles,
} from "@/lib/domain/invitation-copy";

/** What the server found when it looked at the link (without using it up). */
export type InviteCardState =
  | ({ kind: "valid"; ownerName: string | null; expiresOn: string } & InvitationRoles)
  | { kind: "expired" }
  | { kind: "invalid" }
  | { kind: "limited" };

type Phase = "choose" | "working" | "accepted" | "declined" | "expired" | "invalid";

const INVALID_MESSAGE =
  "This invitation link isn't valid. It may have been used already, or the person may have cancelled it. If you still want to take part, ask them to send a new invitation.";
const EXPIRED_MESSAGE =
  "Invitation links work for 14 days. Ask the person who invited you to send a new one.";

/**
 * The public page for an emailed invitation. Opening the link only shows information: accepting
 * or declining happens on click (a POST), never on page load, so a mail scanner that opens the
 * link cannot use it up.
 */
export function InviteCard({ token, state }: { token: string; state: InviteCardState }) {
  const [phase, setPhase] = useState<Phase>(
    state.kind === "expired" ? "expired" : state.kind === "invalid" ? "invalid" : "choose"
  );
  const [error, setError] = useState("");
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const userAnswered = useRef(false);

  // After the person presses a button, move focus to the new heading so keyboard and screen
  // reader users hear the result. Not on first load: the page is already read from the top.
  useEffect(() => {
    if (userAnswered.current && phase !== "choose" && phase !== "working") headingRef.current?.focus();
  }, [phase]);

  const answer = async (which: "accept" | "decline") => {
    if (phase === "working") return;
    userAnswered.current = true;
    setPhase("working");
    setError("");
    try {
      const res = await fetch(`/api/invite/${which}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data: { code?: string; error?: string } = await res.json().catch(() => ({}));
      if (res.ok) {
        setPhase(which === "accept" ? "accepted" : "declined");
        return;
      }
      if (data.code === "INVITATION_EXPIRED") return setPhase("expired");
      if (data.code === "INVITATION_INVALID") return setPhase("invalid");
      setError(
        res.status === 429
          ? "Too many attempts. Wait a few minutes and try again."
          : "We couldn't save your answer. Check your connection and try again."
      );
      setPhase("choose");
    } catch {
      setError("We couldn't save your answer. Check your connection and try again.");
      setPhase("choose");
    }
  };

  return (
    <main className="min-h-dvh bg-canvas flex flex-col items-center justify-center px-4 py-8 sm:p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-lg border border-border bg-card rounded-2xl p-5 sm:p-8 shadow-sm text-left">
        {state.kind === "limited" ? (
          <Message
            icon={<TimerReset className="w-9 h-9 text-foreground-secondary" aria-hidden="true" />}
            title="Please wait a few minutes"
            headingRef={headingRef}
          >
            <p>You have opened invitation links too many times in a short while. Wait a few minutes, then open your link again.</p>
          </Message>
        ) : phase === "expired" ? (
          <Message
            icon={<Clock className="w-9 h-9 text-foreground-secondary" aria-hidden="true" />}
            title="This invitation has expired"
            headingRef={headingRef}
          >
            <p>{EXPIRED_MESSAGE}</p>
          </Message>
        ) : phase === "invalid" ? (
          <Message
            icon={<Link2Off className="w-9 h-9 text-foreground-secondary" aria-hidden="true" />}
            title="This invitation link isn't valid"
            headingRef={headingRef}
          >
            <p>{INVALID_MESSAGE}</p>
          </Message>
        ) : state.kind === "valid" && phase === "accepted" ? (
          <Message
            icon={<CheckCircle2 className="w-9 h-9 text-accent-text" aria-hidden="true" />}
            title="Thank you. You've accepted"
            headingRef={headingRef}
          >
            <p>
              {state.ownerName ?? UNNAMED_OWNER} can now see that you accepted as {roleSummary(state)}. You do not need to do anything else for now.
            </p>
            {state.isBeneficiary && (
              <p>
                They will give you a separate private link for opening your items. Keep it safe. Nothing is shared with you until Dusk&apos;s checks are complete.
              </p>
            )}
            {state.isTrustedVerifier && (
              <p>If they stop checking in, Dusk will email you to ask what you know.</p>
            )}
          </Message>
        ) : state.kind === "valid" && phase === "declined" ? (
          <Message
            icon={<CheckCircle2 className="w-9 h-9 text-accent-text" aria-hidden="true" />}
            title="You've declined"
            headingRef={headingRef}
          >
            <p>Nothing was shared, and this link no longer works. You will not be asked again unless {state.ownerName ?? "they"} sends a new invitation.</p>
          </Message>
        ) : state.kind === "valid" ? (
          <ChooseView
            state={state}
            working={phase === "working"}
            error={error}
            onAccept={() => answer("accept")}
            onDecline={() => answer("decline")}
          />
        ) : null}
      </div>
      {(phase === "accepted" || phase === "declined") && (
        <Link href="/" className="mt-6 text-sm text-accent-text font-medium underline underline-offset-2 inline-flex min-h-11 items-center">
          Learn about Dusk
        </Link>
      )}
    </main>
  );
}

function Message({
  icon,
  title,
  children,
  headingRef,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground-secondary">
      <div>{icon}</div>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      {children}
    </div>
  );
}

function ChooseView({
  state,
  working,
  error,
  onAccept,
  onDecline,
}: {
  state: Extract<InviteCardState, { kind: "valid" }>;
  working: boolean;
  error: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const owner = state.ownerName ?? UNNAMED_OWNER;
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-text">
          <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          Invitation to Dusk
        </p>
        <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-foreground leading-tight">
          {owner} has asked you to be {roleSummary(state)}
        </h1>
        <p className="text-[15px] text-foreground-secondary leading-relaxed">
          Dusk is a secure place to keep important documents and final wishes for the people someone trusts. Here is what this means for you.
        </p>
      </div>

      <ul className="space-y-3 text-[15px] leading-relaxed text-foreground list-none">
        {roleExplanations(owner, state).map((line) => (
          <li key={line} className="border-l-2 border-brand/50 pl-3">
            {line}
          </li>
        ))}
      </ul>

      <p className="text-[15px] text-foreground-secondary leading-relaxed">{acceptMeaning(owner)}</p>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
        <button type="button" onClick={onDecline} disabled={working} className={`${buttonSecondaryClass} sm:flex-1`}>
          Decline
        </button>
        <button type="button" onClick={onAccept} disabled={working} className={`${buttonPrimaryClass} sm:flex-1`}>
          {working ? "Saving..." : "Accept invitation"}
        </button>
      </div>

      <p className="text-[13px] text-foreground-secondary leading-relaxed">
        If you would rather not, you can close this page or choose Decline. Nothing happens unless you choose. This link works once and expires on {state.expiresOn}.
      </p>
    </div>
  );
}
