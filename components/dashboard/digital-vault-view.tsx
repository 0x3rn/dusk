"use client";

import React, { useState } from "react";
import {
  Lock,
  KeyRound,
  Trash2,
  Eye,
  EyeOff,
  Search,
} from "lucide-react";
import {
  VaultItemData,
  ContactData,
  AssignmentData,
} from "./types";
import { formatDate } from "@/lib/display-format";
import { ITEM_CATEGORIES, categoryLabel } from "./item-categories";
import {
  PASSPHRASE_HINT,
  PASSPHRASE_PROBLEM_MESSAGES,
  findNewPassphraseProblem,
} from "@/lib/crypto/passphrase-policy";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Notice } from "@/components/ui/notice";
import {
  buttonPrimaryClass,
  fieldHintClass,
  fieldInputClass,
  fieldLabelClass,
  fieldTextareaClass,
} from "@/components/ui/form-field";

interface DigitalVaultViewProps {
  vault: { id: string; currentKeyVersion: number; items: VaultItemData[] } | null;
  contacts: ContactData[];
  assignments: AssignmentData[];
  isVaultUnlocked: boolean;
  decryptedItems: Record<string, { title: string; content: string; itemKeyBase64: string }>;
  onInitializeVault: (passphrase: string) => Promise<void>;
  onUnlockPassphrase: (passphrase: string) => Promise<void>;
  onUnlockRecoveryKit: (code: string) => Promise<void>;
  onLockVault: () => void;
  onCreateItem: (title: string, category: string, content: string, contactIds: string[]) => Promise<void>;
  onToggleBeneficiaryAssignment: (item: VaultItemData, contact: ContactData) => Promise<void>;
  onDeleteItem: (itemId: string) => Promise<void>;
}

export function DigitalVaultView({
  vault,
  contacts,
  assignments,
  isVaultUnlocked,
  decryptedItems,
  onInitializeVault,
  onUnlockPassphrase,
  onUnlockRecoveryKit,
  onLockVault,
  onCreateItem,
  onToggleBeneficiaryAssignment,
  onDeleteItem,
}: DigitalVaultViewProps) {
  // Passphrase & unlock form state
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [passphraseError, setPassphraseError] = useState("");
  const [isCreatingVault, setIsCreatingVault] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  // New item form state
  const [itemTitle, setItemTitle] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("CREDENTIAL");
  const [itemContent, setItemContent] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [isSavingItem, setIsSavingItem] = useState(false);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [revealedSecretIds, setRevealedSecretIds] = useState<Record<string, boolean>>({});
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  // Only people who accepted their invitation can be given items.
  const beneficiaryContacts = contacts.filter((c) => c.isBeneficiary && c.status === "VERIFIED");

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUnlocking(true);
    try {
      if (showRecoveryUnlock) {
        await onUnlockRecoveryKit(recoveryCode);
        setRecoveryCode("");
      } else {
        await onUnlockPassphrase(passphrase);
        setPassphrase("");
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemTitle.trim() || !itemContent) return;
    setIsSavingItem(true);
    try {
      await onCreateItem(itemTitle, itemCategory, itemContent, selectedContactIds);
      setItemTitle("");
      setItemContent("");
      setSelectedContactIds([]);
    } finally {
      setIsSavingItem(false);
    }
  };

  const toggleRevealSecret = (itemId: string) => {
    setRevealedSecretIds((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  // Filtered vault items
  const items = vault?.items || [];
  const filteredItems = items.filter((item) => {
    const dec = decryptedItems[item.id];
    const titleMatch = dec
      ? dec.title.toLowerCase().includes(searchQuery.toLowerCase())
      : item.id.toLowerCase().includes(searchQuery.toLowerCase());
    const categoryMatch = categoryFilter === "ALL" || item.category === categoryFilter;
    return titleMatch && categoryMatch;
  });

  return (
    <div className="space-y-8 text-left">
      {/* 1. Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center mb-1 flex-wrap gap-x-2.5 gap-y-2">
            <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
              Digital vault
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-accent-surface text-accent-text border border-brand/25 text-[13px] font-semibold">
              <Lock className="w-3.5 h-3.5 text-accent-text stroke-[2]" />
              <span>Encrypted on your device</span>
            </span>
          </div>
          <p className="text-[14px] sm:text-[15px] text-foreground-secondary">
            Save passwords, documents and notes, and choose who receives each one.
          </p>
        </div>

        {isVaultUnlocked && (
          <div>
            <button
              type="button"
              onClick={onLockVault}
              className="inline-flex items-center gap-2 h-11 sm:pointer-fine:h-10 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
            >
              <Lock className="w-4 h-4" />
              <span>Lock vault</span>
            </button>
          </div>
        )}
      </div>

      {/* 2. Locked State vs Unlocked State */}
      {!vault ? (
        /* Initialization Card */
        <div className="border border-border bg-card rounded-[14px] max-w-xl mx-auto p-6 sm:p-8">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-accent-surface text-accent-text flex items-center justify-center mx-auto mb-4">
              <KeyRound className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
            </div>
            <h2 className="text-[20px] font-semibold text-foreground mb-2">
              Create your master passphrase
            </h2>
            <p className="text-[14px] text-foreground-secondary mb-5 leading-relaxed">
              Your passphrase locks your vault. It is separate from your account password and it never leaves this device.
            </p>
          </div>

          <Notice tone="info" className="mb-5">
            Dusk can&apos;t reset or recover your passphrase. If you forget it, your recovery code is the only way back in. You will get that code next.
          </Notice>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const problem = findNewPassphraseProblem(passphrase, confirmPassphrase);
              if (problem) {
                setPassphraseError(PASSPHRASE_PROBLEM_MESSAGES[problem]);
                return;
              }
              setPassphraseError("");
              setIsCreatingVault(true);
              try {
                await onInitializeVault(passphrase);
                setPassphrase("");
                setConfirmPassphrase("");
              } finally {
                setIsCreatingVault(false);
              }
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="vault-new-passphrase" className={fieldLabelClass}>
                Master passphrase
              </label>
              <input
                id="vault-new-passphrase"
                type={showPassphrase ? "text" : "password"}
                required
                autoComplete="new-password"
                value={passphrase}
                onChange={(e) => {
                  setPassphrase(e.target.value);
                  if (passphraseError) setPassphraseError("");
                }}
                aria-invalid={passphraseError ? true : undefined}
                aria-describedby={
                  passphraseError ? "vault-new-passphrase-hint vault-passphrase-error" : "vault-new-passphrase-hint"
                }
                className={fieldInputClass}
              />
              <span id="vault-new-passphrase-hint" className={fieldHintClass}>
                {PASSPHRASE_HINT}
              </span>
            </div>
            <div>
              <label htmlFor="vault-confirm-passphrase" className={fieldLabelClass}>
                Type it again
              </label>
              <input
                id="vault-confirm-passphrase"
                type={showPassphrase ? "text" : "password"}
                required
                autoComplete="new-password"
                value={confirmPassphrase}
                onChange={(e) => {
                  setConfirmPassphrase(e.target.value);
                  if (passphraseError) setPassphraseError("");
                }}
                aria-invalid={passphraseError ? true : undefined}
                aria-describedby={passphraseError ? "vault-passphrase-error" : undefined}
                className={fieldInputClass}
              />
              {passphraseError && (
                <p id="vault-passphrase-error" role="alert" className="mt-1.5 text-[13px] font-medium text-[var(--danger-fg)]">
                  {passphraseError}
                </p>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showPassphrase}
                onChange={(e) => setShowPassphrase(e.target.checked)}
                className="h-4 w-4"
              />
              Show what I type
            </label>
            <button type="submit" disabled={isCreatingVault} className={`${buttonPrimaryClass} w-full`}>
              {isCreatingVault ? "Creating your vault..." : "Create vault"}
            </button>
          </form>
        </div>
      ) : !isVaultUnlocked ? (
        /* Locked Vault Card */
        <div className="border border-border bg-card rounded-[14px] p-6 sm:p-10 max-w-xl mx-auto text-center">
          <div className="w-14 h-14 rounded-full bg-elevated border border-border flex items-center justify-center mx-auto mb-5 text-accent-text">
            <Lock className="w-6 h-6 stroke-[1.75]" aria-hidden="true" />
          </div>
          <h2 className="text-[22px] font-semibold text-foreground mb-1.5">
            Your vault is locked
          </h2>
          <p className="text-[14px] text-foreground-secondary mb-6">
            Enter your master passphrase to open it. Your items are only ever opened on this device.
          </p>

          <form onSubmit={handleUnlockSubmit} className="space-y-4 text-left">
            {!showRecoveryUnlock ? (
              <div>
                <label htmlFor="vault-passphrase" className={fieldLabelClass}>
                  Master passphrase
                </label>
                <div className="relative">
                  <input
                    id="vault-passphrase"
                    type={showPassphrase ? "text" : "password"}
                    required
                    autoComplete="off"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    className={`${fieldInputClass} pr-12 pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute text-foreground-secondary hover:text-foreground right-1 top-1 h-9 w-9 flex items-center justify-center rounded-[6px] right-0 top-0 inline-flex size-11"
                    aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                    aria-pressed={showPassphrase}
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label htmlFor="vault-recovery-code" className={fieldLabelClass}>
                  Recovery code
                </label>
                <input
                  id="vault-recovery-code"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  className={`${fieldInputClass} font-mono text-[13px]`}
                />
                <span className={fieldHintClass}>It starts with DUSK and is printed on your recovery kit.</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isUnlocking}
              className={`${buttonPrimaryClass} w-full`}
            >
              {isUnlocking ? "Unlocking..." : showRecoveryUnlock ? "Unlock with recovery code" : "Unlock vault"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-border flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRecoveryUnlock(!showRecoveryUnlock)}
              className="text-foreground-secondary hover:text-foreground underline transition-colors text-[14px] py-1 inline-flex min-h-11 items-center px-2"
            >
              {showRecoveryUnlock
                ? "Use my master passphrase instead"
                : "Forgot your passphrase? Use your recovery code"}
            </button>
            <p className="text-[13px] text-foreground-secondary max-w-sm leading-relaxed">
              Dusk never sees your passphrase or what is in your vault.
            </p>
          </div>
        </div>
      ) : (
        /* 3. Unlocked Workspace */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 xl:gap-8 items-start">
          {/* Left Column: Create an encrypted item (approx 5 cols on lg) */}
          <div className="xl:col-span-5 bg-card border border-border rounded-[14px] p-4 sm:p-6 min-w-0">
            <div className="pb-4 border-b border-border mb-5">
              <h2 className="text-[18px] font-semibold text-foreground">
                Add an item
              </h2>
              <p className="text-[13px] text-foreground-secondary mt-0.5">
                It is encrypted on your device before it is saved.
              </p>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label htmlFor="item-title" className={fieldLabelClass}>
                  Title
                </label>
                <input
                  id="item-title"
                  type="text"
                  required
                  maxLength={120}
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="For example: Password manager login"
                  className={fieldInputClass}
                />
              </div>

              <div>
                <label htmlFor="item-category" className={fieldLabelClass}>
                  Type
                </label>
                <select
                  id="item-category"
                  value={itemCategory}
                  onChange={(e) => setItemCategory(e.target.value)}
                  className={fieldInputClass}
                >
                  {ITEM_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="item-content" className={fieldLabelClass}>
                  What to keep private
                </label>
                <textarea
                  id="item-content"
                  required
                  rows={5}
                  value={itemContent}
                  onChange={(e) => setItemContent(e.target.value)}
                  placeholder="Passwords, recovery phrases, access codes, instructions or a personal message"
                  className={`${fieldTextareaClass} font-mono text-[14px] placeholder:font-sans`}
                />
              </div>

              {/* Beneficiary Assignment Chips */}
              {beneficiaryContacts.length === 0 && (
                <p className="text-[13px] text-foreground-secondary">
                  No one will receive this item yet. Add a beneficiary under People &amp; access. They can receive items once they accept their invitation.
                </p>
              )}
              {beneficiaryContacts.length > 0 && (
                <fieldset className="pt-2">
                  <legend className="block text-sm font-medium text-foreground mb-2">
                    Who receives this after release
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {beneficiaryContacts.map((c) => {
                      const isSelected = selectedContactIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelectedContactIds((prev) =>
                              isSelected
                                ? prev.filter((id) => id !== c.id)
                                : [...prev, c.id]
                            );
                          }}
                          className={`text-[14px] min-h-10 px-3.5 py-1.5 rounded-[8px] border transition-colors flex items-center gap-1.5 ${ isSelected ? "bg-accent-surface border-brand/40 text-accent-text font-semibold" : "bg-elevated border-border text-foreground-secondary hover:text-foreground" }`}
                        >
                          <span aria-hidden="true">{isSelected ? "✓" : "+"}</span>
                          <span>{c.fullName}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingItem}
                  className={`${buttonPrimaryClass} w-full`}
                >
                  {isSavingItem ? "Saving..." : "Save to vault"}
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Encrypted Items List (approx 7 cols on lg) */}
          <div className="xl:col-span-7 bg-card border border-border rounded-[14px] p-4 sm:p-6 min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border mb-4">
              <div className="min-w-0">
                <h2 className="text-[18px] font-semibold text-foreground tabular-nums">
                  Your items ({items.length})
                </h2>
                <p className="text-[13px] text-foreground-secondary mt-0.5">
                  Select a name under an item to change who receives it.
                </p>
              </div>

              {/* Filter / Search controls */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-foreground-secondary absolute left-3 top-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
                  <label htmlFor="item-search" className="sr-only">
                    Search your items by title
                  </label>
                  <input
                    id="item-search"
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search titles"
                    className="pr-2.5 border border-input bg-background text-foreground placeholder:text-foreground-muted h-10 pl-9 rounded-[8px] text-[14px] w-36 sm:w-44 h-11 sm:pointer-fine:h-8 w-full"
                  />
                </div>
                <label htmlFor="item-filter" className="sr-only">
                  Show only one type of item
                </label>
                <select
                  id="item-filter"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-2 border border-input bg-background text-foreground-secondary h-10 rounded-[8px] text-[14px] h-11 sm:pointer-fine:h-8 w-full sm:w-auto sm:max-w-44 focus-visible:ring-1 focus-visible:ring-brand"
                >
                  <option value="ALL">All types</option>
                  {ITEM_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Item Rows */}
            {filteredItems.length === 0 ? (
              <div className="py-12 text-center text-foreground-secondary">
                <KeyRound className="w-8 h-8 stroke-[1.5] mx-auto mb-2 text-foreground-secondary/50" aria-hidden="true" />
                <p className="text-[15px] font-medium text-foreground">
                  {items.length === 0 ? "Nothing in your vault yet" : "No items match your search"}
                </p>
                <p className="text-[14px] mt-1">
                  {items.length === 0
                    ? "Use the form to save your first password, document or note."
                    : "Try a different word, or choose All types."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredItems.map((item) => {
                  const dec = decryptedItems[item.id];
                  const isRevealed = revealedSecretIds[item.id] || false;
                  return (
                    <div key={item.id} className="py-4 space-y-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                            <KeyRound className="w-4 h-4 stroke-[1.75]" />
                          </div>
                          <div className="min-w-0">
                            <span className="text-[15px] font-semibold text-foreground block break-words">
                              {dec ? dec.title : "Locked item"}
                            </span>
                            <span className="text-[13px] text-foreground-secondary tabular-nums">
                              {categoryLabel(item.category)} · Added {formatDate(item.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {dec && (
                            <button
                              type="button"
                              onClick={() => toggleRevealSecret(item.id)}
                              aria-expanded={isRevealed}
                              className="text-[14px] h-10 px-3 rounded-[8px] border border-border bg-elevated hover:bg-hover text-foreground transition-colors font-medium min-h-11 sm:pointer-fine:min-h-0 sm:py-1"
                            >
                              {isRevealed ? "Hide details" : "Show details"}
                            </button>
                          )}
                          {pendingDeleteId !== item.id && (
                            <button
                              type="button"
                              onClick={() => setPendingDeleteId(item.id)}
                              className="h-10 w-10 flex items-center justify-center text-foreground-secondary hover:text-[var(--danger-fg)] rounded-[8px] transition-colors"
                              title="Delete this item"
                              aria-label={`Delete ${dec ? dec.title : "this item"}`}
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </div>

                      {pendingDeleteId === item.id && (
                        <ConfirmAction
                          defaultOpen
                          onClose={() => setPendingDeleteId(null)}
                          title={`Delete ${dec ? `"${dec.title}"` : "this item"}?`}
                          description="It is removed from your vault and from everyone it was shared with. This can't be undone."
                          confirmLabel="Delete item"
                          pendingLabel="Deleting..."
                          cancelLabel="Keep it"
                          onConfirm={() => onDeleteItem(item.id)}
                          trigger={() => null}
                        />
                      )}

                      {/* Decrypted Secret Reveal Box */}
                      {dec && isRevealed && (
                        <div className="p-3 rounded-[8px] bg-background border border-border font-mono text-[14px] text-foreground whitespace-pre-wrap break-all">
                          {dec.content}
                        </div>
                      )}

                      {/* Assigned Beneficiary Chips (Interactive grant/revoke) */}
                      {beneficiaryContacts.length > 0 && (
                        <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] text-foreground-secondary mr-1">
                            Receives this item:
                          </span>
                          {beneficiaryContacts.map((c) => {
                            const isAssigned = assignments.some(
                              (a) => a.itemId === item.id && a.contactId === c.id
                            );
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => onToggleBeneficiaryAssignment(item, c)}
                                aria-pressed={isAssigned}
                                className={`text-[13px] min-h-9 px-3 py-1 rounded-[8px] border transition-colors ${ isAssigned ? "bg-accent-surface border-brand/40 text-accent-text font-semibold" : "bg-elevated border-border text-foreground-secondary hover:text-foreground" }`}
                              >
                                <span aria-hidden="true">{isAssigned ? "✓ " : "+ "}</span>
                                {c.fullName}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
