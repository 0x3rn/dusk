"use client";

import React, { useState } from "react";
import {
  Lock,
  KeyRound,
  Shield,
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
import { formatCount, formatDate } from "@/lib/display-format";

const ITEM_CATEGORIES = [
  { value: "CREDENTIAL", label: "Account credentials" },
  { value: "CRYPTO_RECOVERY", label: "Crypto wallet / seed phrase" },
  { value: "FINANCIAL_INSTRUCTION", label: "Financial instructions" },
  { value: "DEVICE_ACCESS", label: "Device access / PIN" },
  { value: "DOCUMENT", label: "Private document note" },
  { value: "FINAL_WISH", label: "Final wishes / message" },
  { value: "SECURE_NOTE", label: "General secure note" },
] as const;

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

  const beneficiaryContacts = contacts.filter((c) => c.isBeneficiary);

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
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-[28px] sm:text-[32px] font-semibold text-foreground tracking-tight">
              Digital vault
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-accent-surface text-accent-text border border-brand/25 text-[12px] font-semibold">
              <Shield className="w-3.5 h-3.5 text-accent-text stroke-[2]" />
              <span>AES-256-GCM · Client-encrypted</span>
            </span>
          </div>
          <p className="text-[14px] sm:text-[15px] text-foreground-secondary">
            Store sensitive information in encrypted items and decide exactly who can receive each one.
          </p>
        </div>

        {isVaultUnlocked && (
          <div>
            <button
              type="button"
              onClick={onLockVault}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[14px] font-medium hover:bg-hover transition-colors"
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
        <div className="border border-border bg-card rounded-[14px] p-8 max-w-xl mx-auto text-center">
          <div className="w-12 h-12 rounded-full bg-accent-surface text-accent-text flex items-center justify-center mx-auto mb-4">
            <KeyRound className="w-6 h-6 stroke-[1.75]" />
          </div>
          <h2 className="text-[20px] font-semibold text-foreground mb-2">
            Set up your master passphrase
          </h2>
          <p className="text-[14px] text-foreground-secondary mb-6 leading-relaxed">
            Your master passphrase encrypts your vault locally in your browser before upload. Dusk servers never receive your passphrase or keys.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await onInitializeVault(passphrase);
              setPassphrase("");
            }}
            className="space-y-4"
          >
            <input
              type="password"
              required
              minLength={8}
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Create master passphrase (minimum 8 characters)..."
              className="w-full h-11 px-3.5 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            />
            <button
              type="submit"
              className="w-full h-11 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Initialize vault
            </button>
          </form>
        </div>
      ) : !isVaultUnlocked ? (
        /* Locked Vault Card */
        <div className="border border-border bg-card rounded-[14px] p-8 sm:p-10 max-w-xl mx-auto text-center">
          <div className="w-14 h-14 rounded-full bg-elevated border border-border flex items-center justify-center mx-auto mb-5 text-accent-text">
            <Lock className="w-6 h-6 stroke-[1.75]" />
          </div>
          <h2 className="text-[22px] font-semibold text-foreground mb-1.5">
            Your vault is locked
          </h2>
          <p className="text-[14px] text-foreground-secondary mb-6">
            Enter your master passphrase to unlock your vault. Everything is decrypted on this device only.
          </p>

          <form onSubmit={handleUnlockSubmit} className="space-y-4 text-left">
            {!showRecoveryUnlock ? (
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1.5">
                  Master passphrase
                </label>
                <div className="relative">
                  <input
                    type={showPassphrase ? "text" : "password"}
                    required
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                    placeholder="Enter your passphrase..."
                    className="w-full h-11 pl-3.5 pr-10 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase(!showPassphrase)}
                    className="absolute right-3 top-3 text-foreground-secondary hover:text-foreground"
                    aria-label={showPassphrase ? "Hide passphrase" : "Show passphrase"}
                  >
                    {showPassphrase ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[12px] font-semibold uppercase tracking-wider text-foreground-secondary mb-1.5">
                  Recovery code
                </label>
                <input
                  type="text"
                  required
                  value={recoveryCode}
                  onChange={(e) => setRecoveryCode(e.target.value)}
                  placeholder="DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  className="w-full h-11 px-3.5 rounded-[8px] border border-border bg-background font-mono text-[13px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={isUnlocking}
              className="w-full h-11 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              {isUnlocking ? "Decrypting in memory..." : showRecoveryUnlock ? "Recover vault" : "Unlock vault"}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-border flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => setShowRecoveryUnlock(!showRecoveryUnlock)}
              className="text-[13px] text-foreground-secondary hover:text-foreground underline transition-colors"
            >
              {showRecoveryUnlock
                ? "Use master passphrase instead"
                : "Lost your passphrase? Use your recovery kit"}
            </button>
            <p className="text-[12px] text-foreground-secondary max-w-sm leading-relaxed">
              Vault contents are encrypted before upload. Unlocking decrypts authorized content locally in your browser.
            </p>
          </div>
        </div>
      ) : (
        /* 3. Unlocked Workspace */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Create an encrypted item (approx 5 cols on lg) */}
          <div className="lg:col-span-5 bg-card border border-border rounded-[14px] p-6">
            <div className="pb-4 border-b border-border mb-5">
              <h2 className="text-[18px] font-semibold text-foreground">
                Create an encrypted item
              </h2>
              <p className="text-[13px] text-foreground-secondary mt-0.5">
                Item is encrypted client-side using a fresh AES-256 key.
              </p>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="e.g. Master Password Manager Sheet"
                  className="w-full h-10 px-3 rounded-[8px] border border-border bg-background text-[14px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                />
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">
                  Category
                </label>
                <select
                  value={itemCategory}
                  onChange={(e) => setItemCategory(e.target.value)}
                  className="w-full h-10 px-3 rounded-[8px] border border-border bg-background text-[14px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {ITEM_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[13px] font-medium text-foreground mb-1.5">
                  Secret data
                </label>
                <textarea
                  required
                  rows={4}
                  value={itemContent}
                  onChange={(e) => setItemContent(e.target.value)}
                  placeholder="Enter passwords, recovery seed phrases, access codes, or private notes..."
                  className="w-full p-3 rounded-[8px] border border-border bg-background text-[13px] font-mono text-foreground placeholder:text-foreground-muted placeholder:font-sans focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand resize-y"
                />
              </div>

              {/* Beneficiary Assignment Chips */}
              {beneficiaryContacts.length > 0 && (
                <div className="pt-2">
                  <label className="block text-[12px] font-medium text-foreground-secondary mb-2">
                    Assign to beneficiaries:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {beneficiaryContacts.map((c) => {
                      const isSelected = selectedContactIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            setSelectedContactIds((prev) =>
                              isSelected
                                ? prev.filter((id) => id !== c.id)
                                : [...prev, c.id]
                            );
                          }}
                          className={`text-[12px] px-3 py-1.5 rounded-[6px] border transition-colors flex items-center gap-1.5 ${ isSelected ? "bg-accent-surface border-brand/40 text-accent-text font-semibold" : "bg-elevated border-border text-foreground-secondary hover:text-foreground" }`}
                        >
                          <span>{isSelected ? "✓" : "+"}</span>
                          <span>{c.fullName}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingItem}
                  className="w-full h-11 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[14px] font-semibold disabled:opacity-60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  {isSavingItem ? "Encrypting and saving..." : "Encrypt and save"}
                </button>
              </div>
            </form>
          </div>

          {/* Right Column: Encrypted Items List (approx 7 cols on lg) */}
          <div className="lg:col-span-7 bg-card border border-border rounded-[14px] p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border mb-4">
              <div>
                <h2 className="text-[18px] font-semibold text-foreground tabular-nums">
                  Encrypted items ({formatCount(items.length, "item")})
                </h2>
                <p className="text-[12px] text-foreground-secondary mt-0.5">
                  Select a beneficiary on an unlocked item to manage their access.
                </p>
              </div>

              {/* Filter / Search controls */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-foreground-secondary absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="h-8 pl-8 pr-2.5 rounded-[6px] border border-border bg-background text-[12px] text-foreground placeholder:text-foreground-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand w-32 sm:w-40"
                  />
                </div>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="h-8 px-2 rounded-[6px] border border-border bg-background text-[12px] text-foreground-secondary focus-visible:outline-none"
                >
                  <option value="ALL">All categories</option>
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
                <KeyRound className="w-8 h-8 stroke-[1.5] mx-auto mb-2 text-foreground-secondary/50" />
                <p className="text-[14px]">
                  {items.length === 0
                    ? "Your vault is currently empty. Add your first secret item above."
                    : "No items match your search filter."}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredItems.map((item) => {
                  const dec = decryptedItems[item.id];
                  const isRevealed = revealedSecretIds[item.id] || false;
                  return (
                    <div key={item.id} className="py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-[8px] bg-elevated border border-border flex items-center justify-center shrink-0 text-accent-text mt-0.5">
                            <KeyRound className="w-4 h-4 stroke-[1.75]" />
                          </div>
                          <div>
                            <span className="text-[15px] font-semibold text-foreground block">
                              {dec ? dec.title : `Encrypted item (${item.id.slice(0, 8)})`}
                            </span>
                            <span className="text-[12px] text-foreground-secondary tabular-nums">
                              {item.category} · {formatDate(item.createdAt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {dec && (
                            <button
                              type="button"
                              onClick={() => toggleRevealSecret(item.id)}
                              className="text-[12px] px-2.5 py-1 rounded-[6px] border border-border bg-elevated hover:bg-hover text-foreground transition-colors font-medium"
                            >
                              {isRevealed ? "Hide secret" : "View secret"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onDeleteItem(item.id)}
                            className="p-1.5 text-foreground-secondary hover:text-[var(--danger-fg)] rounded-[6px] transition-colors"
                            title="Delete item"
                            aria-label="Delete item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Decrypted Secret Reveal Box */}
                      {dec && isRevealed && (
                        <div className="p-3 rounded-[8px] bg-background border border-border font-mono text-[12px] text-foreground whitespace-pre-wrap break-all">
                          {dec.content}
                        </div>
                      )}

                      {/* Assigned Beneficiary Chips (Interactive grant/revoke) */}
                      {beneficiaryContacts.length > 0 && (
                        <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] text-foreground-secondary mr-1">
                            Beneficiary grants:
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
                                className={`text-[11px] px-2 py-0.5 rounded-[4px] border transition-colors ${ isAssigned ? "bg-accent-surface border-brand/40 text-accent-text font-semibold" : "bg-elevated border-border text-foreground-secondary hover:text-foreground" }`}
                              >
                                {isAssigned ? "✓ " : "+ "}
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
