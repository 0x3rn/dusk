"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OverviewView } from "@/components/dashboard/overview-view";
import { DigitalVaultView } from "@/components/dashboard/digital-vault-view";
import { PeopleAccessView } from "@/components/dashboard/people-access-view";
import { AuditTimelineView } from "@/components/dashboard/audit-timeline-view";
import { CheckinPlanView } from "@/components/dashboard/checkin-plan-view";
import { RecoveryKitView } from "@/components/dashboard/recovery-kit-view";
import { SettingsView } from "@/components/dashboard/settings-view";
import {
  DashboardView,
  UserAccount,
  ScheduleData,
  VaultItemData,
  ContactData,
  AssignmentData,
  AuditEventData,
  RecoveryArtifactData,
} from "@/components/dashboard/types";
import {
  createAndWrapVaultMasterKey,
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  unwrapVaultMasterKeyWithPassphrase,
} from "@/lib/crypto/vault-crypto";
import {
  createRecoveryKitForVault,
  recoverVaultMasterKeyFromKit,
  type UserPrintableRecoveryKit,
} from "@/lib/crypto/recovery-kit";
import {
  generateBeneficiaryKeyPair,
  wrapItemKeyForBeneficiary,
} from "@/lib/crypto/beneficiary-wrapping";
import { needsKdfUpgrade, runVaultKdfUpgrade } from "@/lib/crypto/kdf-upgrade";
import { Notice } from "@/components/ui/notice";
import { useCheckoutReturn } from "@/components/billing/use-checkout-return";
import { CryptoTamperOrAuthError } from "@/lib/crypto/vault-crypto";

/** Crypto failures carry developer wording; show the plain fallback instead. */
function messageFor(err: unknown, fallback: string): string {
  if (err instanceof CryptoTamperOrAuthError) return fallback;
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Placeholder that matches the dashboard layout while the first load runs. */
function DashboardSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-screen bg-canvas flex"
    >
      <span className="sr-only">Loading your dashboard</span>
      <div className="hidden lg:block w-[248px] shrink-0 bg-sunken border-r border-border p-5 space-y-3" aria-hidden="true">
        <div className="h-8 w-24 rounded-[8px] bg-border/70 animate-pulse" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-9 rounded-[8px] bg-border/70 animate-pulse" />
        ))}
      </div>
      <div className="flex-1 min-w-0" aria-hidden="true">
        <div className="h-[68px] bg-sunken border-b border-border" />
        <div className="max-w-[1200px] mx-auto p-6 sm:p-8 lg:p-10 space-y-6">
          <div className="h-9 w-64 rounded-[8px] bg-border/70 animate-pulse" />
          <div className="h-44 rounded-[14px] bg-card border border-border animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-[12px] bg-card border border-border animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [currentView, setCurrentView] = useState<DashboardView>("overview");

  // Notifications
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  // Shown after an older vault was upgraded to the stronger passphrase protection.
  const [protectionNotice, setProtectionNotice] = useState("");
  const upgradeInFlight = React.useRef(false);
  const bannerRef = React.useRef<HTMLDivElement | null>(null);

  // Messages must be seen: bring a new one into view, and drop old ones when the page changes.
  useEffect(() => {
    if (errorBanner || successBanner) {
      bannerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [errorBanner, successBanner]);

  const selectView = useCallback((view: DashboardView) => {
    setErrorBanner("");
    setSuccessBanner("");
    setProtectionNotice("");
    setCurrentView(view);
    window.scrollTo({ top: 0 });
  }, []);

  // Persisted Account State
  const [user, setUser] = useState<UserAccount | null>(null);
  const [vault, setVault] = useState<{ id: string; currentKeyVersion: number; kdfAlgorithm: string; kdfSaltBase64: string; wrappedMasterKeyCiphertext: string; wrappedMasterKeyIv: string; items: VaultItemData[] } | null>(null);
  const [schedule, setSchedule] = useState<ScheduleData | null>(null);
  const [contacts, setContacts] = useState<ContactData[]>([]);
  const [recoveryArtifacts, setRecoveryArtifacts] = useState<RecoveryArtifactData[]>([]);
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEventData[]>([]);

  // Client-Only Zero-Knowledge Session Memory
  const [unlockedVmkBase64, setUnlockedVmkBase64] = useState<string | null>(null);
  const [decryptedItems, setDecryptedItems] = useState<
    Record<string, { title: string; content: string; itemKeyBase64: string }>
  >({});
  const [newlyCreatedRecoveryKit, setNewlyCreatedRecoveryKit] =
    useState<UserPrintableRecoveryKit | null>(null);
  const [newlyCreatedBeneficiaryKit, setNewlyCreatedBeneficiaryKit] = useState<{
    contactName: string;
    contactId: string;
    privateKeyBase64: string;
  } | null>(null);

  // Days remaining state calculated upon data arrival
  const [daysRemaining, setDaysRemaining] = useState<number>(90);

  const refreshData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard");
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = await res.json();
      setUser(data.user);
      setVault(data.vault);
      setSchedule(data.schedule);
      setContacts(data.contacts || []);
      setRecoveryArtifacts(data.recoveryArtifacts || []);
      setAssignments(data.assignments || []);
      setAuditEvents(data.auditEvents || []);

      if (data.schedule?.nextDueAt) {
        const due = new Date(data.schedule.nextDueAt).getTime();
        const diff = Math.max(0, Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24)));
        setDaysRemaining(diff);
      } else if (data.schedule?.intervalDays) {
        setDaysRemaining(data.schedule.intervalDays);
      }
    } catch (err) {
      console.error("Dashboard data refresh error:", err);
    }
  }, [router]);

  // Back from the payment page: explain what is happening and wait for the purchase to show up.
  useCheckoutReturn({
    loaded: user !== null,
    hasLifetimeAccess: user?.hasLifetimeAccess === true,
    refresh: refreshData,
    onMessage: setSuccessBanner,
  });

  useEffect(() => {
    let active = true;
    const initialLoad = async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (!active) return;
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) throw new Error(`Dashboard request failed with status ${res.status}`);
        const data = await res.json();
        if (!active) return;
        setLoadError(false);
        setUser(data.user);
        setVault(data.vault);
        setSchedule(data.schedule);
        setContacts(data.contacts || []);
        setRecoveryArtifacts(data.recoveryArtifacts || []);
        setAssignments(data.assignments || []);
        setAuditEvents(data.auditEvents || []);

        if (data.schedule?.nextDueAt) {
          const due = new Date(data.schedule.nextDueAt).getTime();
          const diff = Math.max(0, Math.ceil((due - Date.now()) / (1000 * 60 * 60 * 24)));
          setDaysRemaining(diff);
        } else if (data.schedule?.intervalDays) {
          setDaysRemaining(data.schedule.intervalDays);
        }
      } catch (err) {
        if (active) {
          console.error("Initial load error:", err);
          setLoadError(true);
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialLoad();

    return () => {
      active = false;
    };
  }, [router, loadAttempt]);

  // Decrypt vault items in memory whenever VMK is unlocked
  useEffect(() => {
    if (!unlockedVmkBase64 || !vault?.items) return;
    let isCancelled = false;

    const decryptAll = async () => {
      const nextMap: Record<
        string,
        { title: string; content: string; itemKeyBase64: string }
      > = {};

      for (const item of vault.items) {
        try {
          const { payload, itemKeyBase64 } = await decryptVaultItemPayload<{
            title: string;
            content: string;
          }>({
            bundle: {
              schemaVersion: item.schemaVersion,
              keyVersion: item.keyVersion,
              ciphertextBase64: item.ciphertextBase64,
              ivBase64: item.ivBase64,
              wrappedItemKeyBase64: item.wrappedItemKeyBase64,
              wrappedItemKeyIvBase64: item.wrappedItemKeyIvBase64,
              aadContext: {
                vaultId: vault.id,
                resourceId: item.aadResourceId,
                resourceType: "VAULT_ITEM",
                keyVersion: item.keyVersion,
              },
            },
            vaultMasterKeyBase64: unlockedVmkBase64,
          });

          if (!isCancelled) {
            nextMap[item.id] = {
              title: payload.title,
              content: payload.content,
              itemKeyBase64,
            };
          }
        } catch (err) {
          console.error("Failed to decrypt vault item:", item.id, err);
        }
      }

      if (!isCancelled) {
        setDecryptedItems(nextMap);
      }
    };

    void decryptAll();

    return () => {
      isCancelled = true;
    };
  }, [unlockedVmkBase64, vault]);

  // Handlers
  const handleLockVault = useCallback(() => {
    setUnlockedVmkBase64(null);
    setDecryptedItems({});
    setSuccessBanner("Vault locked. Nothing can be read until you enter your passphrase again.");
  }, []);

  const handleInitializeVault = async (passphrase: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      if (!user) return;
      const vaultKeyContext = "vlt_primary";
      const { masterKeyBase64, wrappedBundle } =
        await createAndWrapVaultMasterKey(passphrase, vaultKeyContext);

      const { clientKit, serverArtifact } = await createRecoveryKitForVault({
        vaultMasterKeyBase64: masterKeyBase64,
        vaultId: vaultKeyContext,
        accountEmail: user.email,
        keyVersion: 1,
      });

      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "INIT_VAULT",
          vaultBundle: {
            wrappedMasterKeyCiphertext: wrappedBundle.wrappedMasterKeyCiphertext,
            wrappedMasterKeyIv: wrappedBundle.wrappedMasterKeyIv,
            kdfSaltBase64: wrappedBundle.kdfSaltBase64,
            kdfAlgorithm: wrappedBundle.kdfAlgorithm,
          },
          recoveryServerArtifact: serverArtifact,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setUnlockedVmkBase64(masterKeyBase64);
      setNewlyCreatedRecoveryKit(clientKit);
      // The recovery code is shown on the Recovery kit page, so take the owner straight there.
      setCurrentView("recovery");
      setSuccessBanner("Your vault is ready. Save your recovery kit now: it is the only way back in if you forget your passphrase.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't set up your vault. Check your connection and try again.")
      );
    }
  };

  /**
   * Quietly moves an older (PBKDF2) vault to Argon2id after a successful passphrase unlock: the same
   * vault key is wrapped again, checked, and only then sent. It never blocks the unlock and never
   * shows an error: if anything goes wrong the vault stays as it was and the next unlock retries.
   */
  const upgradeVaultProtection = async (
    passphrase: string,
    masterKeyBase64: string,
    current: NonNullable<typeof vault>
  ) => {
    if (upgradeInFlight.current || !needsKdfUpgrade(current.kdfAlgorithm)) return;
    upgradeInFlight.current = true;
    try {
      const firstItem = current.items[0];
      const outcome = await runVaultKdfUpgrade({
        vault: current,
        vaultId: "vlt_primary",
        passphrase,
        masterKeyBase64,
        sampleItem: firstItem
          ? {
              schemaVersion: firstItem.schemaVersion,
              keyVersion: firstItem.keyVersion,
              ciphertextBase64: firstItem.ciphertextBase64,
              ivBase64: firstItem.ivBase64,
              wrappedItemKeyBase64: firstItem.wrappedItemKeyBase64,
              wrappedItemKeyIvBase64: firstItem.wrappedItemKeyIvBase64,
              aadContext: {
                vaultId: current.id,
                resourceId: firstItem.aadResourceId,
                resourceType: "VAULT_ITEM",
                keyVersion: firstItem.keyVersion,
              },
            }
          : undefined,
        send: async (request) => {
          const res = await fetch("/api/dashboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
          });
          return { ok: res.ok };
        },
      });
      if (outcome.status === "upgraded") {
        setProtectionNotice("Your vault now uses stronger protection.");
        await refreshData();
      } else if (outcome.status === "skipped") {
        console.warn("Vault protection upgrade skipped; it will be tried again at the next unlock.", outcome.reason);
      }
    } finally {
      upgradeInFlight.current = false;
    }
  };

  const handleUnlockWithPassphrase = async (passphrase: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      if (!vault) throw new Error("We couldn't find your vault. Refresh the page and try again.");
      const vmk = await unwrapVaultMasterKeyWithPassphrase(
        {
          schemaVersion: 1,
          keyVersion: vault.currentKeyVersion,
          kdfAlgorithm: vault.kdfAlgorithm,
          kdfSaltBase64: vault.kdfSaltBase64,
          wrappedMasterKeyCiphertext: vault.wrappedMasterKeyCiphertext,
          wrappedMasterKeyIv: vault.wrappedMasterKeyIv,
        },
        passphrase,
        "vlt_primary"
      );
      setUnlockedVmkBase64(vmk);
      setSuccessBanner("Vault unlocked on this device.");
      // Not awaited: unlocking is done, the upgrade finishes in the background.
      void upgradeVaultProtection(passphrase, vmk, vault);
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "That passphrase didn't open your vault. Check it and try again.")
      );
    }
  };

  const handleUnlockWithRecoveryKit = async (recoveryCode: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const activeArt = recoveryArtifacts[0];
      if (!activeArt) {
        throw new Error("This account has no recovery kit yet.");
      }
      const vmk = await recoverVaultMasterKeyFromKit({
        serverArtifact: {
          schemaVersion: 1,
          keyVersion: activeArt.keyVersion,
          vaultId: "vlt_primary",
          recoveryWrappedVmKBase64: activeArt.recoveryWrappedVmKBase64,
          recoveryWrappedVmKIv: activeArt.recoveryWrappedVmKIv,
          kdfSaltBase64: activeArt.kdfSaltBase64,
          kdfAlgorithm: activeArt.kdfAlgorithm,
          fingerprintHex: activeArt.fingerprintHex,
        },
        recoveryCode,
      });
      setUnlockedVmkBase64(vmk);
      setSuccessBanner("Vault unlocked with your recovery code.");
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "That recovery code didn't work. Check each group of characters and try again.")
      );
    }
  };

  const handleCreateItem = async (
    title: string,
    category: string,
    content: string,
    contactIds: string[]
  ) => {
    if (!unlockedVmkBase64 || !vault) return;
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const resourceId = `itm_${crypto.randomUUID()}`;
      const { bundle, itemKeyBase64 } = await encryptVaultItemPayload({
        payload: {
          title: title.trim(),
          content,
        },
        vaultMasterKeyBase64: unlockedVmkBase64,
        vaultId: vault.id,
        itemId: resourceId,
        keyVersion: vault.currentKeyVersion,
      });

      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_ENCRYPTED_ITEM",
          item: {
            vaultId: vault.id,
            category,
            schemaVersion: bundle.schemaVersion,
            keyVersion: bundle.keyVersion,
            ciphertextBase64: bundle.ciphertextBase64,
            ivBase64: bundle.ivBase64,
            wrappedItemKeyBase64: bundle.wrappedItemKeyBase64,
            wrappedItemKeyIvBase64: bundle.wrappedItemKeyIvBase64,
            aadResourceId: resourceId,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Wrap item key for any selected beneficiaries during creation
      for (const contactId of contactIds) {
        const contact = contacts.find((c) => c.id === contactId);
        if (contact?.isBeneficiary && contact?.publicKeyBase64) {
          const wrappedGrant = await wrapItemKeyForBeneficiary({
            itemKeyBase64,
            beneficiaryPublicKeyBase64: contact.publicKeyBase64,
            vaultId: vault.id,
            contactId: contact.id,
            itemId: resourceId,
            keyVersion: bundle.keyVersion,
          });

          await fetch("/api/dashboard", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "ASSIGN_ITEM_TO_BENEFICIARY",
              assignment: {
                contactId: contact.id,
                itemId: data.item.id,
                beneficiaryWrappedKeyBase64: wrappedGrant.beneficiaryWrappedKeyBase64,
                beneficiaryWrappedKeyIv: wrappedGrant.beneficiaryWrappedKeyIv,
                ephemeralPublicKeyBase64: wrappedGrant.ephemeralPublicKeyBase64,
                keyVersion: wrappedGrant.keyVersion,
              },
            }),
          });
        }
      }

      setSuccessBanner(`Encrypted item "${title.trim()}" saved to your vault.`);
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't save that item. Nothing was added. Try again.")
      );
    }
  };

  const handleToggleItemBeneficiaryAssignment = async (
    item: VaultItemData,
    contact: ContactData
  ) => {
    if (!unlockedVmkBase64 || !vault) {
      setErrorBanner("Unlock your vault first, then change who receives this item.");
      return;
    }
    setErrorBanner("");
    setSuccessBanner("");

    const existing = assignments.find(
      (a) => a.itemId === item.id && a.contactId === contact.id
    );

    try {
      if (existing) {
        const res = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "UNASSIGN_ITEM_FROM_BENEFICIARY",
            contactId: contact.id,
            itemId: item.id,
          }),
        });
        if (!res.ok) throw new Error("We couldn't remove that person from this item. Try again.");
        setSuccessBanner(`${contact.fullName} will no longer receive that item.`);
      } else {
        const dec = decryptedItems[item.id];
        if (!dec) throw new Error("Unlock your vault first, then try again.");
        if (!contact.publicKeyBase64) {
          throw new Error("This person was added without an unlock key, so they can't receive items. Remove them and add them again as a beneficiary.");
        }

        const wrappedGrant = await wrapItemKeyForBeneficiary({
          itemKeyBase64: dec.itemKeyBase64,
          beneficiaryPublicKeyBase64: contact.publicKeyBase64,
          vaultId: vault.id,
          contactId: contact.id,
          itemId: item.aadResourceId,
          keyVersion: item.keyVersion,
        });

        const res = await fetch("/api/dashboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ASSIGN_ITEM_TO_BENEFICIARY",
            assignment: {
              contactId: contact.id,
              itemId: item.id,
              beneficiaryWrappedKeyBase64: wrappedGrant.beneficiaryWrappedKeyBase64,
              beneficiaryWrappedKeyIv: wrappedGrant.beneficiaryWrappedKeyIv,
              ephemeralPublicKeyBase64: wrappedGrant.ephemeralPublicKeyBase64,
              keyVersion: wrappedGrant.keyVersion,
            },
          }),
        });
        if (!res.ok) throw new Error("We couldn't give that person access to this item. Try again.");
        setSuccessBanner(`${contact.fullName} will receive "${dec.title}" after release.`);
      }
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't update who receives this item. Try again.")
      );
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    setErrorBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "DELETE_ENCRYPTED_ITEM", itemId }),
      });
      if (!res.ok) throw new Error("We couldn't delete that item. Try again.");
      setSuccessBanner("Item deleted from your vault.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't delete that item. Try again.")
      );
    }
  };

  const handleAddContact = async (
    name: string,
    email: string,
    phone: string,
    isBeneficiary: boolean,
    isTrustedVerifier: boolean
  ) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      let publicKeyBase64: string | undefined;
      let privateKeyBase64: string | undefined;

      if (isBeneficiary) {
        const kp = await generateBeneficiaryKeyPair();
        publicKeyBase64 = kp.publicKeyBase64;
        privateKeyBase64 = kp.privateKeyBase64;
      }

      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ADD_CONTACT",
          contact: {
            fullName: name,
            email,
            phone: phone || null,
            isBeneficiary,
            isTrustedVerifier,
            publicKeyBase64,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (isBeneficiary && privateKeyBase64 && data.contact) {
        setNewlyCreatedBeneficiaryKit({
          contactName: data.contact.fullName,
          contactId: data.contact.id,
          privateKeyBase64,
        });
      }

      if (data.invitation?.delivered) {
        setSuccessBanner(
          `Invitation sent to ${data.contact.fullName}. They will show as "Waiting for them to accept" until they accept.`
        );
      } else {
        // The person is saved but nothing reached them: say so plainly and point at Resend.
        setErrorBanner(
          `We couldn't send the invitation to ${data.contact.fullName}. Try again with "Resend invitation" next to their name.`
        );
      }
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't send that invitation. Check the details and try again.")
      );
    }
  };

  const handleResendInvite = async (contactId: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    const name = contacts.find((c) => c.id === contactId)?.fullName ?? "this person";
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESEND_INVITE", contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (data.invitation?.delivered) {
        setSuccessBanner(`Invitation sent to ${name} again. The link in their earlier email no longer works.`);
      } else {
        setErrorBanner(`We couldn't send the invitation to ${name}. Try again.`);
      }
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(messageFor(err, `We couldn't send the invitation to ${name}. Try again.`));
    }
  };

  const handleCancelInvite = async (contactId: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL_INVITE", contactId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessBanner("Invitation cancelled. The link in their email no longer works.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(messageFor(err, "We couldn't cancel that invitation. Try again."));
    }
  };

  const handleRevokeContact = async (contactId: string) => {
    setErrorBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE_CONTACT", contactId }),
      });
      if (!res.ok) throw new Error("We couldn't remove that person. Try again.");
      setSuccessBanner("Person removed from your plan.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't remove that person. Try again.")
      );
    }
  };

  const handleCheckIn = async () => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CHECK_IN_NOW" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessBanner("Check-in confirmed. Your schedule was reset.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(messageFor(err, "We couldn't record your check-in. Try again."));
    }
  };

  const handleSaveScheduleSettings = async (
    intervalDays: number,
    gracePeriodDays: number
  ) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_SCHEDULE_CONFIG",
          intervalDays,
          gracePeriodDays,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessBanner("Check-in plan saved.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        messageFor(err, "We couldn't save your check-in plan. Try again.")
      );
    }
  };

  const handlePauseSchedule = async () => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "PAUSE_SCHEDULE",
          pauseDays: 30,
          reason: "Paused from dashboard console",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessBanner("Check-ins are paused for 30 days.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(messageFor(err, "We couldn't pause check-ins. Try again."));
    }
  };

  const handleDownloadRecoveryKit = (kit: UserPrintableRecoveryKit) => {
    const blob = new Blob([JSON.stringify(kit, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dusk-recovery-kit-${kit.fingerprintHex}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSignOut = async () => {
    setErrorBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "LOGOUT" }),
      });
      if (!res.ok) throw new Error("Sign out failed");
      router.push("/login");
    } catch {
      setErrorBanner("We couldn't sign you out. Check your connection and try again.");
    }
  };

  if (loading) return <DashboardSkeleton />;

  if (loadError || !user) {
    return (
      <main className="min-h-screen bg-canvas flex items-center justify-center p-6">
        <div className="w-full max-w-md border border-border bg-card rounded-2xl p-8 text-center min-h-dvh">
          <h1 className="text-xl font-semibold text-foreground mb-2">
            We couldn&apos;t load your dashboard
          </h1>
          <p className="text-sm text-foreground-secondary mb-6">
            This is usually a connection problem. Your vault and settings are safe. Try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => {
              setLoadError(false);
              setLoading(true);
              setLoadAttempt((n) => n + 1);
            }}
            className="inline-flex items-center justify-center h-11 px-5 rounded-[8px] bg-brand text-on-brand text-[15px] font-semibold hover:bg-brand-hover transition-colors"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <DashboardShell
      currentView={currentView}
      onSelectView={selectView}
      user={user}
      isVaultUnlocked={!!unlockedVmkBase64}
      onLockVault={handleLockVault}
      onSignOut={handleSignOut}
    >
      {/* Messages: one box at a time, announced to screen readers, dismissible */}
      <div ref={bannerRef} className="space-y-3 empty:hidden mb-6 scroll-mt-24 sticky top-[4.75rem] sm:top-[5.25rem] z-30">
        {errorBanner && (
          <Notice tone="error" onDismiss={() => setErrorBanner("")}>
            {errorBanner}
          </Notice>
        )}
        {successBanner && (
          <Notice tone="success" onDismiss={() => setSuccessBanner("")}>
            {successBanner}
          </Notice>
        )}
        {protectionNotice && (
          <Notice tone="success" onDismiss={() => setProtectionNotice("")}>
            {protectionNotice}
          </Notice>
        )}
      </div>

      {/* View Switcher */}
      {currentView === "overview" && (
        <OverviewView
          user={user}
          schedule={schedule}
          vault={vault}
          contacts={contacts}
          assignments={assignments}
          auditEvents={auditEvents}
          isVaultUnlocked={!!unlockedVmkBase64}
          decryptedItems={decryptedItems}
          daysRemaining={daysRemaining}
          onNavigate={selectView}
          onCheckIn={handleCheckIn}
          onPauseSchedule={handlePauseSchedule}
          onUnlockPassphrase={handleUnlockWithPassphrase}
          onLockVault={handleLockVault}
        />
      )}

      {currentView === "vault" && (
        <DigitalVaultView
          vault={vault}
          contacts={contacts}
          assignments={assignments}
          isVaultUnlocked={!!unlockedVmkBase64}
          decryptedItems={decryptedItems}
          onInitializeVault={handleInitializeVault}
          onUnlockPassphrase={handleUnlockWithPassphrase}
          onUnlockRecoveryKit={handleUnlockWithRecoveryKit}
          onLockVault={handleLockVault}
          onCreateItem={handleCreateItem}
          onToggleBeneficiaryAssignment={handleToggleItemBeneficiaryAssignment}
          onDeleteItem={handleDeleteItem}
        />
      )}

      {currentView === "people" && (
        <PeopleAccessView
          contacts={contacts}
          assignments={assignments}
          newlyCreatedBeneficiaryKit={newlyCreatedBeneficiaryKit}
          onDismissBeneficiaryKit={() => setNewlyCreatedBeneficiaryKit(null)}
          onAddContact={handleAddContact}
          onRevokeContact={handleRevokeContact}
          onResendInvite={handleResendInvite}
          onCancelInvite={handleCancelInvite}
        />
      )}

      {currentView === "audit" && (
        <AuditTimelineView
          auditEvents={auditEvents}
          contacts={contacts}
          onNavigate={selectView}
        />
      )}

      {currentView === "schedule" && (
        <CheckinPlanView
          schedule={schedule}
          daysRemaining={daysRemaining}
          onSaveSchedule={handleSaveScheduleSettings}
          onPauseSchedule={handlePauseSchedule}
          onCheckInNow={handleCheckIn}
        />
      )}

      {currentView === "recovery" && (
        <RecoveryKitView
          recoveryArtifacts={recoveryArtifacts}
          newlyCreatedRecoveryKit={newlyCreatedRecoveryKit}
          onDownloadKit={handleDownloadRecoveryKit}
          onDismissNewlyCreated={() => setNewlyCreatedRecoveryKit(null)}
        />
      )}

      {currentView === "settings" && (
        <SettingsView
          user={user}
          isVaultUnlocked={!!unlockedVmkBase64}
          onLockVault={handleLockVault}
          onSignOut={handleSignOut}
        />
      )}
    </DashboardShell>
  );
}