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

  const activeArtifact = recoveryArtifacts[0];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-8 text-left max-w-4xl">
      {/* 1. Header */}
      <div className="pb-2 border-b border-border">
        <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
          Your recovery plan
        </h1>
        <p className="text-[14px] sm:text-[15px] text-foreground-secondary mt-1">
          Prepare for the possibility of losing your passphrase or your primary device before you need to recover access.
        </p>
      </div>

      {/* Newly Created Kit Prompt (if just generated) */}
      {newlyCreatedRecoveryKit && (
        <div className="border border-brand/25 bg-accent-surface/40 rounded-[14px] p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-brand/25 dark:border-brand/20 mb-5">
            <div className="flex items-center gap-3">
              <FileKey className="w-5 h-5 text-accent-text shrink-0" />
              <div>
                <h2 className="text-[18px] font-semibold text-foreground">
                  New recovery kit created
                </h2>
                <span className="text-[12px] text-foreground font-mono">
                  Fingerprint: {formatFingerprint(newlyCreatedRecoveryKit.fingerprintHex)}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onDownloadKit(newlyCreatedRecoveryKit)}
              className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[8px] bg-brand text-on-brand text-[13px] font-semibold hover:bg-brand-hover transition-colors shrink-0 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Download className="w-4 h-4" />
              <span>Download recovery kit (.json)</span>
            </button>
          </div>

          <p className="text-[13px] text-foreground mb-3">
            {newlyCreatedRecoveryKit.warningNotice}
          </p>

          <div className="relative mb-3">
            <div className="p-3.5 rounded-[8px] bg-background border border-brand/25 font-mono text-[13px] text-foreground select-all break-all">
              {newlyCreatedRecoveryKit.recoveryCode}
            </div>
            <button
              type="button"
              onClick={() => handleCopy(newlyCreatedRecoveryKit.recoveryCode)}
              className="absolute right-2.5 top-2.5 p-1.5 rounded-[6px] border border-border bg-elevated text-foreground-secondary hover:text-foreground text-[11px] flex items-center gap-1"
            >
              {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedCode ? "Copied" : "Copy"}</span>
            </button>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onDismissNewlyCreated}
              className="text-[12px] font-medium text-accent-text hover:underline"
            >
              I have saved this code in a secure offline location
            </button>
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
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-foreground-secondary">
                Recovery
              </span>
              <h2 className="text-[18px] font-semibold text-foreground">
                Your recovery kit
              </h2>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-[6px] text-[12px] font-semibold border ${ activeArtifact ? "bg-accent-surface border-brand/25 text-accent-text" : "bg-elevated border-border text-foreground-secondary" }`}
          >
            {activeArtifact ? "Ready" : "Not initialized"}
          </span>
        </div>

        {activeArtifact ? (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 text-[14px]">
              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Kit fingerprint
                </span>
                <span className="font-mono font-semibold text-foreground text-[13px] tabular-nums">
                  {formatFingerprint(activeArtifact.fingerprintHex)}
                </span>
                <p className="text-[12px] text-foreground-secondary mt-0.5">
                  Match this against the fingerprint printed on your kit.
                </p>
              </div>

              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Key version
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  Version {activeArtifact.keyVersion}
                </span>
                <p className="text-[12px] text-foreground-secondary mt-0.5">
                  Matches your current vault key version.
                </p>
              </div>

              <div>
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1">
                  Enrollment date
                </span>
                <span className="font-semibold text-foreground tabular-nums">
                  {formatDate(activeArtifact.createdAt)}
                </span>
                <p className="text-[12px] text-foreground-secondary mt-0.5">
                  The day you created this kit.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-[10px] bg-elevated border border-border space-y-2 text-[13px] text-foreground-secondary leading-relaxed">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-accent-text" />
                Recovery works without us
              </div>
              <p>
                Your recovery code can unlock your vault if you lose your passphrase or your device. Dusk can&apos;t do this for you, because we never hold a key that opens your vault.
              </p>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-foreground-secondary">
            <p className="text-[14px]">
              No active recovery kit enrolled yet. Initialize your vault first to generate your kit.
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
          Dusk can&apos;t reset your passphrase. Your recovery kit is the only way back in if you lose it.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[13px]">
          <div className="p-4 rounded-[8px] border border-border bg-elevated">
            <span className="font-semibold text-foreground block mb-1">
              Physical paper copy
            </span>
            <p className="text-foreground-secondary leading-relaxed">
              Print your recovery kit and place it in a water-resistant, fireproof home safe or safety deposit box.
            </p>
          </div>

          <div className="p-4 rounded-[8px] border border-border bg-elevated">
            <span className="font-semibold text-foreground block mb-1">
              Estate counsel
            </span>
            <p className="text-foreground-secondary leading-relaxed">
              Deposit a sealed copy with your estate attorney alongside your will or power-of-attorney documents.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
