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
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<DashboardView>("overview");

  // Notifications
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");

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
        const data = await res.json();
        if (!active) return;
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
        if (active) console.error("Initial load error:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialLoad();

    return () => {
      active = false;
    };
  }, [router]);

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
    setSuccessBanner("Vault locked in memory. Decrypted contents purged.");
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
      setSuccessBanner("Encrypted vault initialized. Please save your recovery kit.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to initialize vault."
      );
    }
  };

  const handleUnlockWithPassphrase = async (passphrase: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      if (!vault) throw new Error("Vault not found.");
      const iterations = Number(vault.kdfAlgorithm?.split("-")[2]) || 600_000;
      const vmk = await unwrapVaultMasterKeyWithPassphrase(
        {
          schemaVersion: 1,
          keyVersion: vault.currentKeyVersion,
          kdfAlgorithm: vault.kdfAlgorithm,
          kdfIterations: iterations,
          kdfSaltBase64: vault.kdfSaltBase64,
          wrappedMasterKeyCiphertext: vault.wrappedMasterKeyCiphertext,
          wrappedMasterKeyIv: vault.wrappedMasterKeyIv,
        },
        passphrase,
        "vlt_primary"
      );
      setUnlockedVmkBase64(vmk);
      setSuccessBanner("Vault unlocked successfully in browser memory.");
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Incorrect master passphrase."
      );
    }
  };

  const handleUnlockWithRecoveryKit = async (recoveryCode: string) => {
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const activeArt = recoveryArtifacts[0];
      if (!activeArt) {
        throw new Error("No active recovery kit found for this account.");
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
      setSuccessBanner("Vault unlocked with your recovery kit.");
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Invalid recovery kit code."
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
        err instanceof Error ? err.message : "Failed to save vault item."
      );
    }
  };

  const handleToggleItemBeneficiaryAssignment = async (
    item: VaultItemData,
    contact: ContactData
  ) => {
    if (!unlockedVmkBase64 || !vault) {
      setErrorBanner("Unlock your vault first to modify beneficiary key grants.");
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
        if (!res.ok) throw new Error("Failed to unassign beneficiary.");
        setSuccessBanner(`Removed ${contact.fullName} from item access.`);
      } else {
        const dec = decryptedItems[item.id];
        if (!dec) throw new Error("Item key not available in memory.");
        if (!contact.publicKeyBase64) {
          throw new Error("Beneficiary public key not found.");
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
        if (!res.ok) throw new Error("Failed to assign beneficiary.");
        setSuccessBanner(`Granted ${contact.fullName} selective access to "${dec.title}".`);
      }
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to update assignment."
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
      if (!res.ok) throw new Error("Failed to delete item.");
      setSuccessBanner("Item deleted from vault.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to delete item."
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

      setSuccessBanner(`${data.contact.fullName} added to your estate contacts.`);
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to add contact."
      );
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
      if (!res.ok) throw new Error("Failed to remove contact.");
      setSuccessBanner("Contact removed from estate plan.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to remove contact."
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
      setErrorBanner(err instanceof Error ? err.message : "Check-in failed.");
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
      setSuccessBanner("Schedule parameters updated successfully.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to update schedule."
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
      setSuccessBanner("Check-in schedule paused for 30 days.");
      await refreshData();
    } catch (err: unknown) {
      setErrorBanner(err instanceof Error ? err.message : "Failed to pause.");
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
    await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "LOGOUT" }),
    });
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-elevated flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-6 h-6 border-2 border-foreground border-t-transparent rounded-full animate-spin" />
          <span className="text-[13px] text-foreground-secondary font-medium">
            Loading secure console...
          </span>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <DashboardShell
      currentView={currentView}
      onSelectView={setCurrentView}
      user={user}
      isVaultUnlocked={!!unlockedVmkBase64}
      onLockVault={handleLockVault}
      onSignOut={handleSignOut}
    >
      {/* Alert Banners */}
      {errorBanner && (
        <div className="mb-6 p-4 rounded-[10px] bg-[var(--danger-bg)] border border-[var(--danger-fg)] text-[var(--danger-fg)] text-[13px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-[var(--danger-fg)]" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner("")}
            className="text-[var(--danger-fg)] hover:opacity-80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successBanner && (
        <div className="mb-6 p-4 rounded-[10px] bg-accent-surface border border-brand/25 text-accent-text text-[13px] font-medium flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0" />
            <span>{successBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessBanner("")}
            className="text-accent-text hover:text-accent-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
          onNavigate={setCurrentView}
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
        />
      )}

      {currentView === "audit" && (
        <AuditTimelineView
          auditEvents={auditEvents}
          contacts={contacts}
          onNavigate={setCurrentView}
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