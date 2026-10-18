"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  Clock,
  Plus,
  Phone,
  Mail,
  User,
  ShieldAlert,
  Key,
  LogOut,
  Lock,
  Unlock,
  CheckCircle2,
  FileKey,
  Trash2,
  PauseCircle,
  Settings,
  Download,
  Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/theme-toggle";
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

const ITEM_CATEGORIES = [
  { value: "CREDENTIAL", label: "Account Credentials" },
  { value: "CRYPTO_RECOVERY", label: "Crypto Wallet / Seed Phrase" },
  { value: "FINANCIAL_INSTRUCTION", label: "Financial Instructions" },
  { value: "DEVICE_ACCESS", label: "Device Access / PIN" },
  { value: "DOCUMENT", label: "Private Document Note" },
  { value: "FINAL_WISH", label: "Final Wishes / Message" },
  { value: "SECURE_NOTE", label: "General Secure Note" },
] as const;

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");

  // Persisted Account State
  const [user, setUser] = useState<any>(null);
  const [vault, setVault] = useState<any>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [recoveryArtifacts, setRecoveryArtifacts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);

  // Client-Only Zero-Knowledge Session Memory
  const [unlockedVmkBase64, setUnlockedVmkBase64] = useState<string | null>(
    null
  );
  const [masterPassphrase, setMasterPassphrase] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false);
  const [newlyCreatedRecoveryKit, setNewlyCreatedRecoveryKit] =
    useState<UserPrintableRecoveryKit | null>(null);
  const [newlyCreatedBeneficiaryKit, setNewlyCreatedBeneficiaryKit] = useState<{
    contactName: string;
    contactId: string;
    privateKeyBase64: string;
  } | null>(null);

  const [decryptedItems, setDecryptedItems] = useState<
    Record<string, { title: string; content: string; itemKeyBase64: string }>
  >({});

  // Vault Item Form
  const [itemTitle, setItemTitle] = useState("");
  const [itemCategory, setItemCategory] = useState<string>("CRYPTO_RECOVERY");
  const [itemContent, setItemContent] = useState("");
  const [assignToContactIds, setAssignToContactIds] = useState<string[]>([]);

  // Contact Form
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [isBeneficiary, setIsBeneficiary] = useState(true);
  const [isTrustedVerifier, setIsTrustedVerifier] = useState(false);

  // Schedule Settings Modal/Collapse
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [intervalDaysInput, setIntervalDaysInput] = useState(90);
  const [gracePeriodDaysInput, setGracePeriodDaysInput] = useState(14);

  const fetchDashboard = useCallback(async () => {
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
      if (data.schedule) {
        setIntervalDaysInput(data.schedule.intervalDays);
        setGracePeriodDaysInput(data.schedule.gracePeriodDays);
      }
      setContacts(data.contacts || []);
      setRecoveryArtifacts(data.recoveryArtifacts || []);
      setAssignments(data.assignments || []);
      setAuditEvents(data.auditEvents || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Decrypt vault items in memory whenever VMK is unlocked
  useEffect(() => {
    if (!unlockedVmkBase64 || !vault?.items) return;
    (async () => {
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
          nextMap[item.id] = {
            title: payload.title,
            content: payload.content,
            itemKeyBase64,
          };
        } catch (err) {
          console.error("Failed to decrypt vault item:", item.id, err);
        }
      }
      setDecryptedItems(nextMap);
    })();
  }, [unlockedVmkBase64, vault]);

  const daysRemaining = schedule?.nextDueAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(schedule.nextDueAt).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 90;

  const totalIntervalDays = schedule?.intervalDays || 90;

  const handleInitializeVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const vaultKeyContext = "vlt_primary";
      const { masterKeyBase64, wrappedBundle } =
        await createAndWrapVaultMasterKey(masterPassphrase, vaultKeyContext);

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
            wrappedMasterKeyCiphertext:
              wrappedBundle.wrappedMasterKeyCiphertext,
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
      setMasterPassphrase("");
      setSuccessBanner("Encrypted vault initialized. Download your Recovery Kit below.");
      await fetchDashboard();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to initialize vault."
      );
    }
  };

  const handleUnlockWithPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const iterations =
        Number(vault.kdfAlgorithm?.split("-")[2]) || 600_000;
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
        masterPassphrase,
        "vlt_primary"
      );
      setUnlockedVmkBase64(vmk);
      setMasterPassphrase("");
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Incorrect master passphrase."
      );
    }
  };

  const handleUnlockWithRecoveryKit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const activeArt = recoveryArtifacts[0];
      if (!activeArt) {
        throw new Error("No active Recovery Kit found for this account.");
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
        recoveryCode: recoveryCodeInput,
      });
      setUnlockedVmkBase64(vmk);
      setRecoveryCodeInput("");
      setShowRecoveryUnlock(false);
      setSuccessBanner("Vault unlocked via Recovery Kit.");
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Invalid Recovery Kit code."
      );
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockedVmkBase64 || !vault) return;
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const resourceId = `itm_${crypto.randomUUID()}`;
      const { bundle, itemKeyBase64 } = await encryptVaultItemPayload({
        payload: {
          title: itemTitle.trim(),
          content: itemContent,
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
            category: itemCategory,
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
      for (const contactId of assignToContactIds) {
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
                beneficiaryWrappedKeyBase64:
                  wrappedGrant.beneficiaryWrappedKeyBase64,
                beneficiaryWrappedKeyIv: wrappedGrant.beneficiaryWrappedKeyIv,
                ephemeralPublicKeyBase64:
                  wrappedGrant.ephemeralPublicKeyBase64,
                keyVersion: wrappedGrant.keyVersion,
              },
            }),
          });
        }
      }

      setItemTitle("");
      setItemContent("");
      setAssignToContactIds([]);
      setSuccessBanner("Item encrypted locally and saved to your vault.");
      await fetchDashboard();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to save vault item."
      );
    }
  };

  const handleToggleItemBeneficiaryAssignment = async (
    item: any,
    contact: any
  ) => {
    if (!unlockedVmkBase64) {
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
              beneficiaryWrappedKeyBase64:
                wrappedGrant.beneficiaryWrappedKeyBase64,
              beneficiaryWrappedKeyIv: wrappedGrant.beneficiaryWrappedKeyIv,
              ephemeralPublicKeyBase64: wrappedGrant.ephemeralPublicKeyBase64,
              keyVersion: wrappedGrant.keyVersion,
            },
          }),
        });
        if (!res.ok) throw new Error("Failed to assign beneficiary.");
        setSuccessBanner(`Granted ${contact.fullName} encrypted access to "${dec.title}".`);
      }
      await fetchDashboard();
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
      await fetchDashboard();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Failed to delete item."
      );
    }
  };

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
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
            fullName: contactName,
            email: contactEmail,
            phone: contactPhone,
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

      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setSuccessBanner(`${data.contact.fullName} added to your contacts.`);
      await fetchDashboard();
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
      await fetchDashboard();
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
      setSuccessBanner("Proof-of-life confirmed. Check-in timer reset.");
      await fetchDashboard();
    } catch (err: unknown) {
      setErrorBanner(
        err instanceof Error ? err.message : "Check-in failed."
      );
    }
  };

  const handleSaveScheduleSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorBanner("");
    setSuccessBanner("");
    try {
      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPDATE_SCHEDULE_CONFIG",
          intervalDays: intervalDaysInput,
          gracePeriodDays: gracePeriodDaysInput,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowScheduleSettings(false);
      setSuccessBanner("Check-in schedule updated.");
      await fetchDashboard();
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
          reason: "Paused from dashboard",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSuccessBanner("Dead-Man's Switch paused for 30 days.");
      await fetchDashboard();
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
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  const beneficiaryContacts = contacts.filter((c) => c.isBeneficiary);

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Nav */}
      <nav className="border-b border-border bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Shield strokeWidth={1.5} className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">Dusk.</span>
          </Link>
          <div className="flex items-center gap-4">
            {unlockedVmkBase64 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUnlockedVmkBase64(null);
                  setDecryptedItems({});
                }}
              >
                <Lock className="w-3.5 h-3.5 mr-1.5" /> Lock Vault
              </Button>
            )}
            <ThemeToggle />
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {user.fullName || user.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
              title="Sign Out"
            >
              <LogOut strokeWidth={1.5} className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-12 max-w-6xl space-y-8">
        {errorBanner && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
            {errorBanner}
          </div>
        )}
        {successBanner && (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/20 text-primary text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successBanner}</span>
          </div>
        )}

        {/* Status Panel */}
        <Card className="border-primary/20 bg-card overflow-hidden relative">
          <div className="absolute right-0 top-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -z-10" />
          <CardContent className="p-8 space-y-6">
            <div className="flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="flex items-center gap-6">
                <div className="w-20 h-20 rounded-full border-4 border-primary/30 flex items-center justify-center relative bg-background shrink-0">
                  <Clock strokeWidth={1.5} className="w-8 h-8 text-primary" />
                  <svg className="absolute inset-0 w-full h-full -rotate-90">
                    <circle
                      cx="50%"
                      cy="50%"
                      r="38"
                      className="stroke-primary/20 fill-none"
                      strokeWidth="4"
                    />
                    <circle
                      cx="50%"
                      cy="50%"
                      r="38"
                      className="stroke-primary fill-none transition-all duration-1000"
                      strokeWidth="4"
                      strokeDasharray="238"
                      strokeDashoffset={
                        238 -
                        238 * Math.min(1, daysRemaining / totalIntervalDays)
                      }
                    />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-2xl font-bold">
                      Status: {schedule?.state || "HEALTHY"}
                    </h2>
                  </div>
                  <p className="text-muted-foreground">
                    <span className="text-primary font-mono text-xl mr-2">
                      {daysRemaining}
                    </span>
                    days until next proof-of-life check-in is due (
                    {schedule?.gracePeriodDays || 14}-day grace period).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <Button
                  size="lg"
                  onClick={handleCheckIn}
                  className="h-12 px-7 rounded-full flex-1 md:flex-none"
                >
                  I am alive (Check In)
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={handlePauseSchedule}
                  title="Pause check-ins for 30 days (travel/illness)"
                >
                  <PauseCircle className="w-5 h-5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-12 w-12 rounded-full"
                  onClick={() => setShowScheduleSettings(!showScheduleSettings)}
                  title="Configure check-in schedule"
                >
                  <Settings className="w-5 h-5" />
                </Button>
              </div>
            </div>

            {showScheduleSettings && (
              <form
                onSubmit={handleSaveScheduleSettings}
                className="pt-6 border-t border-border grid sm:grid-cols-3 gap-4 items-end"
              >
                <div>
                  <label className="text-xs font-medium block mb-1.5">
                    Check-In Interval (Days)
                  </label>
                  <Input
                    type="number"
                    min={7}
                    max={365}
                    value={intervalDaysInput}
                    onChange={(e) =>
                      setIntervalDaysInput(Number(e.target.value))
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5">
                    Grace Period Before Escalation (Days)
                  </label>
                  <Input
                    type="number"
                    min={3}
                    max={90}
                    value={gracePeriodDaysInput}
                    onChange={(e) =>
                      setGracePeriodDaysInput(Number(e.target.value))
                    }
                  />
                </div>
                <Button type="submit">Save Schedule Settings</Button>
              </form>
            )}
          </CardContent>
        </Card>

        {/* One-Time Recovery Kit Banner */}
        {newlyCreatedRecoveryKit && (
          <Card className="border-primary bg-primary/5">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-primary">
                  <FileKey className="w-5 h-5" /> Save Your Offline Recovery Kit
                </span>
                <Button
                  size="sm"
                  onClick={() =>
                    handleDownloadRecoveryKit(newlyCreatedRecoveryKit)
                  }
                >
                  <Download className="w-4 h-4 mr-1.5" /> Download Recovery Kit
                </Button>
              </CardTitle>
              <CardDescription>
                {newlyCreatedRecoveryKit.warningNotice}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-sm">
              <div className="p-3 rounded-lg bg-background border border-border select-all">
                {newlyCreatedRecoveryKit.recoveryCode}
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Kit Fingerprint: {newlyCreatedRecoveryKit.fingerprintHex}
                </span>
                <button
                  type="button"
                  onClick={() => setNewlyCreatedRecoveryKit(null)}
                  className="text-primary hover:underline"
                >
                  I have saved this offline
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Vault Setup / Unlock Gate */}
        {!vault ? (
          <Card className="bg-card border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" /> Set Up Your Master Encryption Key
              </CardTitle>
              <CardDescription>
                Your Master Passphrase encrypts your vault locally in your browser. It is never sent to Dusk servers.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={handleInitializeVault}
                className="flex flex-col sm:flex-row gap-4 max-w-xl"
              >
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={masterPassphrase}
                  onChange={(e) => setMasterPassphrase(e.target.value)}
                  placeholder="Create Master Passphrase (min 8 characters)..."
                  className="flex-1"
                />
                <Button type="submit">
                  <Lock className="w-4 h-4 mr-2" /> Initialize Vault
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : !unlockedVmkBase64 ? (
          <Card className="bg-card border-border">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Unlock className="w-5 h-5 text-primary" /> Unlock Your Encrypted Vault
                  </CardTitle>
                  <CardDescription>
                    Enter your Master Passphrase to decrypt your vault items in browser memory.
                  </CardDescription>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRecoveryUnlock(!showRecoveryUnlock)}
                  className="text-xs text-primary hover:underline"
                >
                  {showRecoveryUnlock
                    ? "Use Master Passphrase"
                    : "Lost passphrase? Use Recovery Kit"}
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {!showRecoveryUnlock ? (
                <form
                  onSubmit={handleUnlockWithPassphrase}
                  className="flex flex-col sm:flex-row gap-4 max-w-xl"
                >
                  <Input
                    type="password"
                    required
                    value={masterPassphrase}
                    onChange={(e) => setMasterPassphrase(e.target.value)}
                    placeholder="Enter Master Passphrase..."
                    className="flex-1"
                  />
                  <Button type="submit">Unlock Vault</Button>
                </form>
              ) : (
                <form
                  onSubmit={handleUnlockWithRecoveryKit}
                  className="flex flex-col sm:flex-row gap-4 max-w-xl"
                >
                  <Input
                    type="text"
                    required
                    value={recoveryCodeInput}
                    onChange={(e) => setRecoveryCodeInput(e.target.value)}
                    placeholder="DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 font-mono"
                  />
                  <Button type="submit">Recover Vault</Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* Main Content Tabs */}
        <Tabs defaultValue="vault" className="w-full">
          <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent h-auto p-0 space-x-6">
            <TabsTrigger
              value="vault"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 text-base data-[state=active]:shadow-none"
            >
              <Key strokeWidth={1.5} className="w-4 h-4 mr-2" /> Digital Vault
            </TabsTrigger>
            <TabsTrigger
              value="contacts"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 text-base data-[state=active]:shadow-none"
            >
              <User strokeWidth={1.5} className="w-4 h-4 mr-2" /> Beneficiaries & Trusted Contacts
            </TabsTrigger>
            <TabsTrigger
              value="activity"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 pb-4 text-base data-[state=active]:shadow-none"
            >
              <Activity strokeWidth={1.5} className="w-4 h-4 mr-2" /> Audit Timeline
            </TabsTrigger>
          </TabsList>

          {/* Vault Section */}
          <TabsContent value="vault" className="mt-8 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Add New Secret Form */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ShieldAlert
                      strokeWidth={1.5}
                      className="w-5 h-5 text-primary"
                    />
                    Add to Vault
                  </CardTitle>
                  <CardDescription>
                    All payloads are AES-256-GCM encrypted before leaving your browser.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateItem} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Title</label>
                      <Input
                        required
                        disabled={!unlockedVmkBase64}
                        value={itemTitle}
                        onChange={(e) => setItemTitle(e.target.value)}
                        placeholder="e.g. Main Hardware Wallet"
                        className="bg-transparent border-border"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Category</label>
                      <select
                        disabled={!unlockedVmkBase64}
                        value={itemCategory}
                        onChange={(e) => setItemCategory(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                      >
                        {ITEM_CATEGORIES.map((cat) => (
                          <option key={cat.value} value={cat.value}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Secret Data</label>
                      <Textarea
                        required
                        disabled={!unlockedVmkBase64}
                        value={itemContent}
                        onChange={(e) => setItemContent(e.target.value)}
                        placeholder="Enter passwords, seed phrases, or private instructions..."
                        className="bg-transparent border-border h-32 resize-none"
                      />
                    </div>

                    {beneficiaryContacts.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">
                          Assign to Beneficiaries (Selective Release):
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {beneficiaryContacts.map((c) => {
                            const selected = assignToContactIds.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                type="button"
                                disabled={!unlockedVmkBase64}
                                onClick={() =>
                                  setAssignToContactIds((prev) =>
                                    selected
                                      ? prev.filter((id) => id !== c.id)
                                      : [...prev, c.id]
                                  )
                                }
                                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                  selected
                                    ? "border-primary bg-primary/10 text-primary font-medium"
                                    : "border-border text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                {selected ? "✓ " : "+ "}
                                {c.fullName}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={!unlockedVmkBase64}
                      className="w-full"
                    >
                      <Lock strokeWidth={1.5} className="w-4 h-4 mr-2" />
                      {unlockedVmkBase64
                        ? "Encrypt and Save"
                        : "Unlock Vault Above to Add Items"}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              {/* List of Secrets */}
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Encrypted Items ({vault?.items?.length || 0})
                  </CardTitle>
                  <CardDescription>
                    Click a beneficiary badge on any unlocked item to grant or revoke selective access.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {!vault?.items?.length ? (
                      <p className="text-sm text-muted-foreground py-8 text-center">
                        Your vault is currently empty.
                      </p>
                    ) : (
                      vault.items.map((item: any) => {
                        const dec = decryptedItems[item.id];
                        return (
                          <div
                            key={item.id}
                            className="p-4 rounded-xl border border-border bg-background/50 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                  <Lock
                                    strokeWidth={1.5}
                                    className="w-4 h-4 text-primary"
                                  />
                                </div>
                                <div>
                                  <p className="font-medium">
                                    {dec
                                      ? dec.title
                                      : `Encrypted Item (${item.id.slice(0, 8)})`}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {item.category} •{" "}
                                    {new Date(
                                      item.createdAt
                                    ).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className="border-border text-xs"
                                >
                                  {dec ? "Decrypted" : "Locked"}
                                </Badge>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="text-muted-foreground hover:text-destructive"
                                  title="Delete item"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </div>

                            {dec && (
                              <div className="p-3 rounded-lg bg-muted/40 font-mono text-xs whitespace-pre-wrap break-all">
                                {dec.content}
                              </div>
                            )}

                            {beneficiaryContacts.length > 0 && (
                              <div className="pt-2 border-t border-border/60 flex flex-wrap items-center gap-1.5">
                                <span className="text-[11px] text-muted-foreground mr-1">
                                  Assigned Beneficiaries:
                                </span>
                                {beneficiaryContacts.map((c) => {
                                  const isAssigned = assignments.some(
                                    (a) =>
                                      a.itemId === item.id &&
                                      a.contactId === c.id
                                  );
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      disabled={!unlockedVmkBase64}
                                      onClick={() =>
                                        handleToggleItemBeneficiaryAssignment(
                                          item,
                                          c
                                        )
                                      }
                                      className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-colors ${
                                        isAssigned
                                          ? "border-primary bg-primary/15 text-primary font-medium"
                                          : "border-border text-muted-foreground hover:text-foreground"
                                      }`}
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
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Beneficiaries & Trusted Contacts Section */}
          <TabsContent value="contacts" className="mt-8 space-y-6">
            {newlyCreatedBeneficiaryKit && (
              <Card className="border-primary bg-primary/5">
                <CardHeader>
                  <CardTitle className="text-base text-primary flex items-center justify-between">
                    <span>
                      Share Decryption Key Material with{" "}
                      {newlyCreatedBeneficiaryKit.contactName}
                    </span>
                    <button
                      type="button"
                      onClick={() => setNewlyCreatedBeneficiaryKit(null)}
                      className="text-xs underline"
                    >
                      Dismiss
                    </button>
                  </CardTitle>
                  <CardDescription>
                    Dusk never stores a beneficiary&apos;s private key on the server. Provide this emergency unlock URL (with its #hash decryption key) to{" "}
                    {newlyCreatedBeneficiaryKit.contactName}:
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="p-3 rounded-lg bg-background border border-border font-mono text-xs break-all select-all">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/unlock/${newlyCreatedBeneficiaryKit.contactId}#${newlyCreatedBeneficiaryKit.privateKeyBase64}`
                      : ""}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-3 gap-6">
              <Card className="md:col-span-1 bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Add Contact</CardTitle>
                  <CardDescription>
                    Separate who receives vault items (Beneficiary) from who verifies status (Trusted Verifier).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAddContact} className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Full Name</label>
                      <div className="relative">
                        <User
                          strokeWidth={1.5}
                          className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        />
                        <Input
                          required
                          value={contactName}
                          onChange={(e) => setContactName(e.target.value)}
                          placeholder="Jane Doe"
                          className="pl-9 bg-transparent border-border"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Email Address
                      </label>
                      <div className="relative">
                        <Mail
                          strokeWidth={1.5}
                          className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        />
                        <Input
                          required
                          type="email"
                          value={contactEmail}
                          onChange={(e) => setContactEmail(e.target.value)}
                          placeholder="jane@example.com"
                          className="pl-9 bg-transparent border-border"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Phone Number (Optional)
                      </label>
                      <div className="relative">
                        <Phone
                          strokeWidth={1.5}
                          className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
                        />
                        <Input
                          value={contactPhone}
                          onChange={(e) => setContactPhone(e.target.value)}
                          placeholder="+1 (555) 000-0000"
                          className="pl-9 bg-transparent border-border"
                        />
                      </div>
                    </div>

                    <div className="space-y-2 pt-1 text-sm">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBeneficiary}
                          onChange={(e) => setIsBeneficiary(e.target.checked)}
                        />
                        <span>Beneficiary (Receives assigned items)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isTrustedVerifier}
                          onChange={(e) =>
                            setIsTrustedVerifier(e.target.checked)
                          }
                        />
                        <span>Trusted Verifier (Confirms alive/release)</span>
                      </label>
                    </div>

                    <Button type="submit" className="w-full mt-2">
                      <Plus strokeWidth={1.5} className="w-4 h-4 mr-2" /> Add Contact
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="md:col-span-2 bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">Active Contacts</CardTitle>
                  <CardDescription>
                    Manage recipients and trusted verifiers for your digital estate.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent">
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Roles</TableHead>
                        <TableHead>Assigned Items</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.map((contact) => {
                        const assignedCount = assignments.filter(
                          (a) => a.contactId === contact.id
                        ).length;
                        return (
                          <TableRow
                            key={contact.id}
                            className="border-border hover:bg-muted/50"
                          >
                            <TableCell className="font-medium">
                              {contact.fullName}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {contact.email}
                            </TableCell>
                            <TableCell className="space-x-1.5">
                              {contact.isBeneficiary && (
                                <Badge
                                  variant="outline"
                                  className="border-primary/40 text-primary bg-primary/10"
                                >
                                  Beneficiary
                                </Badge>
                              )}
                              {contact.isTrustedVerifier && (
                                <Badge variant="outline">Verifier</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {contact.isBeneficiary
                                ? `${assignedCount} item(s)`
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={() => handleRevokeContact(contact.id)}
                                className="text-muted-foreground hover:text-destructive"
                                title="Revoke contact"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Audit Timeline Section */}
          <TabsContent value="activity" className="mt-8">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">
                  Security & Audit Timeline
                </CardTitle>
                <CardDescription>
                  Append-only operational record of account, vault, contact, and check-in activity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {auditEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-lg border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-x-2">
                      <Badge variant="outline" className="font-mono">
                        {ev.eventType}
                      </Badge>
                      <span className="font-mono text-muted-foreground">
                        {ev.redactedMeta}
                      </span>
                    </div>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}