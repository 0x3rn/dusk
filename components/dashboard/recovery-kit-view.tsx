"use client";

import React, { useState } from "react";
import {
  FileKey,
  Download,
  CheckCircle2,
  Copy,
  Check,
} from "lucide-react";
import { RecoveryArtifactData } from "./types";
import { formatDate, formatFingerprint } from "@/lib/display-format";
import { UserPrintableRecoveryKit } from "@/lib/crypto/recovery-kit";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Notice } from "@/components/ui/notice";

interface RecoveryKitViewProps {
  recoveryArtifacts: RecoveryArtifactData[];
  newlyCreatedRecoveryKit: UserPrintableRecoveryKit | null;
  onDownloadKit: (kit: UserPrintableRecoveryKit) => void;
  onDismissNewlyCreated: () => void;
}

export function RecoveryKitView({
  recoveryArtifacts,
  newlyCreatedRecoveryKit,
  onDownloadKit,
  onDismissNewlyCreated,
}: RecoveryKitViewProps) {
  const [copiedCode, setCopiedCode] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const activeArtifact = recoveryArtifacts[0];

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      // Clipboard can be blocked by the browser. The code is still selectable on screen.
      setCopyFailed(true);
    }
  };

  return (
    <div className="space-y-8 text-left max-w-4xl">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          Recovery kit
                  </h1>
                  <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
                    Your recovery code is the only way back into your vault if you forget your passphrase or lose your device.
                  </p>
      </div>

      {/* Newly Created Kit Prompt (if just generated) */}
      {newlyCreatedRecoveryKit && (
        <div className="border border-brand/25 bg-accent-surface/40 rounded-[14px] p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand/25 dark:border-brand/20 mb-5">
            <div className="flex items-center gap-3">
              <FileKey className="w-5 h-5 text-accent-text shrink-0" aria-hidden="true" />
              <div>
                <h2 className="text-[18px] font-semibold text-foreground">
                  Save your recovery code now
                </h2>
                <span className="text-[13px] text-foreground font-mono">
                  Kit ID: {formatFingerprint(newlyCreatedRecoveryKit.fingerprintHex)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDownloadKit(newlyCreatedRecoveryKit)}
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[8px] bg-brand text-on-brand text-[14px] font-semibold hover:bg-brand-hover transition-colors shrink-0"
                          >
                            <Download className="w-4 h-4" aria-hidden="true" />
              <span>Download recovery kit</span>
            </button>
          </div>

          <p className="text-[14px] text-foreground mb-3 leading-relaxed">
            {newlyCreatedRecoveryKit.warningNotice}
          </p>
          <Notice tone="info" className="mb-3">
            This code is shown only once. Print it or save the file somewhere safe and offline before you close this box.
          </Notice>

          <div className="relative mb-3">
            <div className="p-3.5 pr-28 rounded-[8px] bg-background border border-brand/40 font-mono text-[14px] text-foreground select-all break-all">
              {newlyCreatedRecoveryKit.recoveryCode}
            </div>
            <button
              type="button"
              onClick={() => handleCopy(newlyCreatedRecoveryKit.recoveryCode)}
                          className="absolute right-2 top-2 h-10 px-3 rounded-[8px] border border-border bg-elevated text-foreground hover:bg-hover text-[14px] font-medium flex items-center gap-1.5"
                        >
                          {copiedCode ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
                          <span>{copiedCode ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                      <p role="status" className="text-[13px] text-foreground-secondary min-h-5 mb-2">
                        {copiedCode ? "Code copied to your clipboard." : copyFailed ? "Your browser blocked copying. Select the code above and copy it by hand." : ""}
                      </p>

                      <div className="flex justify-end">
                        <ConfirmAction
                          tone="default"
                          title="Have you saved your recovery code?"
                          description="Once you close this box, Dusk can't show the code again. Without it, a forgotten passphrase means your vault can't be opened."
                          confirmLabel="Yes, I've saved it"
                          cancelLabel="Not yet"
                          onConfirm={onDismissNewlyCreated}
                          trigger={(props) => (
                            <button
                              type="button"
                              {...props}
                              className="inline-flex items-center justify-center h-11 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
                            >
                              I&apos;ve saved my code somewhere safe
                            </button>
                          )}
                        />
                      </div>
        </div>
      )}

      {/* 2. Recovery Status Card */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <div className="flex items-center justify-between pb-5 border-b border-border mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-accent-text">
              <FileKey className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-[18px] font-semibold text-foreground">
                Your recovery kit
              </h2>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-[6px] text-[13px] font-semibold border ${ activeArtifact ? "bg-accent-surface border-brand/25 text-accent-text" : "bg-elevated border-border text-foreground-secondary" }`}
          >
            {activeArtifact ? "Created" : "Not created yet"}
          </span>
        </div>

        {activeArtifact ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-[14px]">
              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Kit ID
                </span>
                <span className="font-mono font-semibold text-foreground text-[13px] tabular-nums">
                  {formatFingerprint(activeArtifact.fingerprintHex)}
                </span>
                <p className="text-[13px] text-foreground-secondary mt-0.5">
                  Check that this matches the ID printed on your kit.
                </p>
              </div>

              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Kit version
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  Version {activeArtifact.keyVersion}
                </span>
                <p className="text-[13px] text-foreground-secondary mt-0.5">
                  If you change your vault keys, make a new kit.
                </p>
              </div>

              <div>
                <span className="block text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Created on
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatDate(activeArtifact.createdAt)}
                </span>
                <p className="text-[13px] text-foreground-secondary mt-0.5">
                  The day this kit was made.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-[10px] bg-elevated border border-border space-y-2 text-[13px] text-foreground-secondary leading-relaxed">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-accent-text" aria-hidden="true" />
                              Only you can use it
              </div>
              <p>
                Your recovery code opens your vault if you lose your passphrase or your device. Dusk can&apos;t do this for you, because we never hold a key that opens your vault.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-foreground-secondary">
            <p className="text-[14px]">
              You don&apos;t have a recovery kit yet. It is created when you set up your vault in the Digital vault page.
            </p>
          </div>
        )}
      </div>

      {/* 3. Physical Storage Guidance */}
      <div className="border border-border bg-card rounded-[14px] p-6 sm:p-7">
        <h3 className="text-[17px] font-semibold text-foreground mb-2">
          Where to keep your recovery kit
        </h3>
        <p className="text-[13px] text-foreground-secondary mb-5 leading-relaxed">
          Dusk can&apos;t reset your passphrase. Keep your recovery code where you, and only people you trust, can find it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          <div className="p-4 rounded-[8px] border border-border bg-elevated">
            <span className="font-semibold text-foreground block mb-1">
              Physical paper copy
            </span>
            <p className="text-foreground-secondary leading-relaxed">
              Print your recovery code and keep it in a fireproof home safe or a safe deposit box.
            </p>
          </div>

          <div className="p-4 rounded-[8px] border border-border bg-elevated">
            <span className="font-semibold text-foreground block mb-1">
              With your lawyer
            </span>
            <p className="text-foreground-secondary leading-relaxed">
              Leave a sealed copy with your estate lawyer, next to your will or power of attorney.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
