"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, Trash2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth/cooldown";
import {
  checkDeletionForm,
  impactNeedsAcknowledgement,
  loadReleaseImpact,
  requestDeletionCode,
  submitAccountDeletion,
  type DeletionFormErrors,
  type DisplayedImpact,
} from "@/lib/account/delete-account-client";
import { useCooldown } from "@/components/auth/use-cooldown";
import { Notice } from "@/components/ui/notice";
import {
  buttonDangerClass,
  buttonSecondaryClass,
  fieldHintClass,
  fieldInputClass,
  fieldLabelClass,
} from "@/components/ui/form-field";

type Step = "closed" | "confirm";

function ReleaseWarning({ impact }: { impact: DisplayedImpact }) {
  if (impact === "RELEASED") {
    return (
      <Notice tone="error">
        <p className="font-semibold">Your plan has already been released.</p>
        <p className="mt-1 font-normal">
          The people you named may already have been emailed, and may be opening their items right now. If you delete
          your account, everything they have not opened yet is destroyed and their links stop working straight away.
          Anything someone has already opened and saved is theirs, and we can&apos;t take it back.
        </p>
      </Notice>
    );
  }
  if (impact === "IN_PROGRESS") {
    return (
      <Notice tone="error">
        <p className="font-semibold">A release is under way for your plan.</p>
        <p className="mt-1 font-normal">
          You missed check-ins, so Dusk has started asking the people you chose to confirm. If you delete your account,
          that stops. Nobody is told and nothing is released, so the people you named receive nothing. If you are
          fine and want to keep your plan, don&apos;t delete: check in instead.
        </p>
      </Notice>
    );
  }
  if (impact === "UNKNOWN") {
    return (
      <Notice tone="error">
        <p className="font-semibold">We couldn&apos;t check whether a release is under way.</p>
        <p className="mt-1 font-normal">
          If one has started or has finished, deleting your account stops it, and the people you named lose access to
          anything they have not opened yet.
        </p>
      </Notice>
    );
  }
  return null;
}

/**
 * A clearly separated danger section. Deleting needs three things from the owner: a code emailed to
 * their account address, their account email typed out, and (when a release is involved) a ticked
 * box. The server checks the code and the email itself; nothing here is trusted.
 */
export function DeleteAccountCard({ email }: { email: string }) {
  const [step, setStep] = useState<Step>("closed");
  const [impact, setImpact] = useState<DisplayedImpact | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<DeletionFormErrors>({});
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const codeRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);

  // Find out how a release stands, so the warning matches this account.
  useEffect(() => {
    let cancelled = false;
    void loadReleaseImpact((url) => fetch(url, { credentials: "same-origin", cache: "no-store" })).then((result) => {
      if (!cancelled) setImpact(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (step === "confirm" && codeSent) codeRef.current?.focus();
  }, [step, codeSent]);

  const needsAck = impact !== null && impactNeedsAcknowledgement(impact);

  const close = () => {
    setStep("closed");
    setCodeSent(false);
    setCode("");
    setConfirmEmail("");
    setAcknowledged(false);
    setFieldErrors({});
    setError("");
    // Put the keyboard back where the person started.
    requestAnimationFrame(() => openRef.current?.focus());
  };

  const sendCode = async () => {
    if (sending || deleting) return;
    setError("");
    setSending(true);
    const result = await requestDeletionCode(authClient, email);
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCodeSent(true);
    cooldown.start();
    setStep("confirm");
  };

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleting || impact === null) return;
    setError("");
    const checked = checkDeletionForm({ accountEmail: email, confirmEmail, code, impact, acknowledged });
    if (!checked.ok) {
      setFieldErrors(checked.errors);
      return;
    }
    setFieldErrors({});
    setDeleting(true);
    const result = await submitAccountDeletion((url, init) => fetch(url, { ...init, credentials: "same-origin" }), {
      confirmEmail,
      code: checked.code,
      acknowledgeReleaseImpact: acknowledged,
    });
    if (result.ok) {
      // A full page load drops everything held in memory, including any unlocked vault key.
      window.location.assign("/account-deleted");
      return;
    }
    setDeleting(false);
    setError(result.message);
  };

  return (
    <section
      id="delete-account"
      aria-labelledby="delete-account-heading"
      className="border border-[var(--danger-fg)]/50 bg-card rounded-[14px] p-5 sm:p-7"
    >
      <div className="flex items-center gap-2 mb-1">
        <Trash2 className="w-5 h-5 text-[var(--danger-fg)]" aria-hidden="true" />
        <h2 id="delete-account-heading" className="text-[18px] font-semibold text-foreground">
          Delete account
        </h2>
      </div>
      <p className="text-[13px] text-foreground-secondary mb-5">
        This permanently deletes your Dusk account. It cannot be undone.
      </p>

      <div className="space-y-5 border-t border-border pt-5 text-[14px] text-foreground-secondary">
        <div>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">What we delete</h3>
          <ul className="list-disc pl-5 space-y-1.5 marker:text-foreground-muted">
            <li>Your account and sign-in.</li>
            <li>Your encrypted vault: every item and folder, and your recovery data.</li>
            <li>The people you added, and what you set aside for each of them.</li>
            <li>Your check-in schedule and its history, and your activity and message records.</li>
          </ul>
        </div>

        <div>
          <h3 className="text-[15px] font-semibold text-foreground mb-2">What this means</h3>
          <ul className="list-disc pl-5 space-y-1.5 marker:text-foreground-muted">
            <li>
              Dusk can&apos;t read your vault, so we can&apos;t restore or recover any of it. Not for you, and not on
              request.
            </li>
            <li>
              The people you named lose any role they had. They are not told, nothing is sent to them, and any unlock
              link you gave them stops working.
            </li>
            <li>
              A record that you paid (an order number, never your card) stays in our payment ledger. It no longer
              connects to any account.
            </li>
            <li>
              Copies in our database backups are removed as the backups age out, within 30 days.
            </li>
            <li>You can use the same email address again later, as a brand new, empty account.</li>
          </ul>
        </div>

        {impact === null ? (
          <p aria-live="polite" className="text-[13px]">
            Checking your plan...
          </p>
        ) : (
          <>
            <ReleaseWarning impact={impact} />
            {impact === "NONE" && (
              <p>
                Deleting your account also ends your check-in plan. If you want the people you chose to have something,
                give it to them another way first.
              </p>
            )}
          </>
        )}

        {error && <Notice tone="error">{error}</Notice>}

        {step === "closed" && (
          <button
            ref={openRef}
            type="button"
            onClick={() => {
              setError("");
              setStep("confirm");
            }}
            disabled={impact === null}
            aria-expanded={false}
            aria-controls="delete-account-form"
            className={`${buttonSecondaryClass} w-full sm:w-auto text-[var(--danger-fg)] border-[var(--danger-fg)]/50`}
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete my account...
          </button>
        )}

        {step === "confirm" && (
          <form id="delete-account-form" onSubmit={handleDelete} className="space-y-4 max-w-md" noValidate>
            {!codeSent ? (
              <div className="space-y-3">
                <p>
                  To make sure it&apos;s you, we first email a 6-digit code to{" "}
                  <span className="font-medium text-foreground break-all">{email}</span>.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    type="button"
                    onClick={sendCode}
                    disabled={sending}
                    className={`${buttonSecondaryClass} w-full sm:w-auto`}
                  >
                    <Mail className="w-4 h-4" aria-hidden="true" />
                    {sending ? "Sending..." : "Email me a code"}
                  </button>
                  <button type="button" onClick={close} className={`${buttonSecondaryClass} w-full sm:w-auto`}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <Notice tone="info">
                  We sent a 6-digit code to <span className="break-all font-semibold">{email}</span>. It can take a
                  minute to arrive.
                </Notice>

                <div>
                  <label htmlFor="delete-code" className={fieldLabelClass}>
                    6-digit code
                  </label>
                  <input
                    ref={codeRef}
                    id="delete-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    aria-invalid={fieldErrors.code ? true : undefined}
                    aria-describedby={fieldErrors.code ? "delete-code-error" : undefined}
                    className={`${fieldInputClass} tracking-widest`}
                    placeholder="123456"
                  />
                  {fieldErrors.code && (
                    <span id="delete-code-error" role="alert" className="block text-[13px] text-[var(--danger-fg)] mt-1.5">
                      {fieldErrors.code}
                    </span>
                  )}
                </div>

                <div>
                  <label htmlFor="delete-confirm-email" className={fieldLabelClass}>
                    Type your email to confirm
                  </label>
                  <input
                    id="delete-confirm-email"
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    value={confirmEmail}
                    onChange={(e) => setConfirmEmail(e.target.value)}
                    aria-invalid={fieldErrors.confirmEmail ? true : undefined}
                    aria-describedby={
                      fieldErrors.confirmEmail ? "delete-confirm-email-error" : "delete-confirm-email-hint"
                    }
                    className={fieldInputClass}
                    placeholder={email}
                  />
                  {fieldErrors.confirmEmail ? (
                    <span
                      id="delete-confirm-email-error"
                      role="alert"
                      className="block text-[13px] text-[var(--danger-fg)] mt-1.5"
                    >
                      {fieldErrors.confirmEmail}
                    </span>
                  ) : (
                    <span id="delete-confirm-email-hint" className={`${fieldHintClass} break-all`}>
                      Your account email is {email}.
                    </span>
                  )}
                </div>

                {needsAck && (
                  <div>
                    <label className="flex items-start gap-3 text-[14px] text-foreground cursor-pointer min-h-11">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(e) => setAcknowledged(e.target.checked)}
                        aria-invalid={fieldErrors.acknowledged ? true : undefined}
                        aria-describedby={fieldErrors.acknowledged ? "delete-ack-error" : undefined}
                        className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--danger-fg)]"
                      />
                      <span>
                        I understand that deleting my account stops my plan, and the people I named will not receive
                        what I set aside for them.
                      </span>
                    </label>
                    {fieldErrors.acknowledged && (
                      <span id="delete-ack-error" role="alert" className="block text-[13px] text-[var(--danger-fg)] mt-1">
                        {fieldErrors.acknowledged}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button type="submit" disabled={deleting} className={`${buttonDangerClass} w-full sm:w-auto`}>
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    {deleting ? "Deleting..." : "Delete my account permanently"}
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    disabled={deleting}
                    className={`${buttonSecondaryClass} w-full sm:w-auto`}
                  >
                    Cancel
                  </button>
                </div>

                <button
                  type="button"
                  onClick={sendCode}
                  disabled={sending || deleting || cooldown.remaining > 0}
                  className="text-sm text-accent-text disabled:opacity-60 min-h-11 underline underline-offset-2"
                >
                  {cooldown.remaining > 0 ? `Send a new code in ${cooldown.remaining}s` : "Send a new code"}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
