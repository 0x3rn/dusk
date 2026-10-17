"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Shield,
  Clock,
  Plus,
  User,
  ShieldAlert,
  Key,
  LogOut,
  Lock,
  Unlock,
  CheckCircle2,
  FileKey,
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
  decryptAssignedItemAsBeneficiary,
  generateBeneficiaryKeyPair,
  wrapItemKeyForBeneficiary,
} from "@/lib/crypto/beneficiary-wrapping";

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [statusSuccess, setStatusSuccess] = useState("");

  // Server state from Neon Postgres
  const [user, setUser] = useState<any>(null);
  const [vault, setVault] = useState<any>(null);
  const [schedule, setSchedule] = useState<any>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [recoveryArtifacts, setRecoveryArtifacts] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);

  // Client-only Zero-Knowledge Cryptographic State (never sent to server)
  const [unlockedVmkBase64, setUnlockedVmkBase64] = useState<string | null>(null);
  const [masterPassphrase, setMasterPassphrase] = useState("");
  const [recoveryCodeInput, setRecoveryCodeInput] = useState("");
  const [generatedKit, setGeneratedKit] = useState<UserPrintableRecoveryKit | null>(
    null
  );
  const [decryptedItems, setDecryptedItems] = useState<
    Record<string, { title: string; content: string; itemKeyBase64: string }>
  >({});

  // Form states
  const [itemTitle, setItemTitle] = useState("");
  const [itemCategory, setItemCategory] = useState("CRYPTO_RECOVERY");
  const [itemSecretContent, setItemSecretContent] = useState("");

  // Contact form states (THE-100)
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [isBeneficiary, setIsBeneficiary] = useState(true);
  const [isTrustedVerifier, setIsTrustedVerifier] = useState(false);
  // Store generated beneficiary private keys in client state so you can test beneficiary decryption in localhost!
  const [localBeneficiaryPrivKeys, setLocalBeneficiaryPrivKeys] = useState<
    Record<string, string>
  >({});

  // Selective Release Assignment states (THE-101)
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedContactId, setSelectedContactId] = useState("");
  const [beneficiaryTestOutput, setBeneficiaryTestOutput] = useState<string>("");

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

  // Automatically decrypt vault items in browser memory once VMK is unlocked
  useEffect(() => {
    if (!unlockedVmkBase64 || !vault?.items) return;
    (async () => {
      const map: Record<
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
          map[item.id] = {
            title: payload.title,
            content: payload.content,
            itemKeyBase64,
          };
        } catch (err) {
          console.error("Failed to decrypt item", item.id, err);
        }
      }
      setDecryptedItems(map);
    })();
  }, [unlockedVmkBase64, vault]);

  // 1. Initialize Zero-Knowledge Vault + Recovery Kit (THE-98 & THE-99)
  const handleInitializeVault = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");
    try {
      const tempVaultId = "vlt_primary";
      const { masterKeyBase64, wrappedBundle } = await createAndWrapVaultMasterKey(
        masterPassphrase,
        tempVaultId,
        100_000
      );

      const { clientKit, serverArtifact } = await createRecoveryKitForVault({
        vaultMasterKeyBase64: masterKeyBase64,
        vaultId: tempVaultId,
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
      setGeneratedKit(clientKit);
      setStatusSuccess(
        "Zero-Knowledge Vault initialized & Recovery Kit generated locally!"
      );
      await fetchDashboard();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Vault init failed.");
    }
  };

  // 2. Unlock Existing Vault with Passphrase (THE-98)
  const handleUnlockWithPassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");
    try {
      const iterations =
        Number(vault.kdfAlgorithm?.split("-")[2]) || 100_000;
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
      setStatusSuccess("Vault Master Key unlocked in browser memory!");
    } catch (err: unknown) {
      setStatusError(
        err instanceof Error ? err.message : "Wrong passphrase or tampered bundle."
      );
    }
  };

  // 3. Unlock Vault via Offline Recovery Kit Code (THE-99)
  const handleUnlockWithRecoveryKit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");
    try {
      const activeArt = recoveryArtifacts[0];
      if (!activeArt) throw new Error("No active recovery artifact found.");
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
      setStatusSuccess(
        "Vault Master Key recovered successfully using your Recovery Kit!"
      );
    } catch (err: unknown) {
      setStatusError(
        err instanceof Error ? err.message : "Recovery Kit verification failed."
      );
    }
  };

  // 4. Encrypt & Save Vault Item Client-Side (THE-98)
  const handleEncryptAndSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockedVmkBase64 || !vault) return;
    setStatusError("");
    setStatusSuccess("");
    try {
      const resourceId = `itm_${crypto.randomUUID()}`;
      const { bundle } = await encryptVaultItemPayload({
        payload: {
          title: itemTitle,
          content: itemSecretContent,
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

      setItemTitle("");
      setItemSecretContent("");
      setStatusSuccess(
        "Secret encrypted with AES-256-GCM in browser and stored as opaque ciphertext in Neon Postgres!"
      );
      await fetchDashboard();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to save item.");
    }
  };

  // 5. Add Beneficiary / Trusted Verifier Contact (THE-100)
  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");
    try {
      let pubKeyBase64: string | undefined;
      let privKeyBase64: string | undefined;
      if (isBeneficiary) {
        const kp = await generateBeneficiaryKeyPair();
        pubKeyBase64 = kp.publicKeyBase64;
        privKeyBase64 = kp.privateKeyBase64;
      }

      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "INVITE_CONTACT",
          contact: {
            fullName: contactName,
            email: contactEmail,
            phone: contactPhone,
            isBeneficiary,
            isTrustedVerifier,
            publicKeyBase64: pubKeyBase64,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (privKeyBase64 && data.contact?.id) {
        setLocalBeneficiaryPrivKeys((prev) => ({
          ...prev,
          [data.contact.id]: privKeyBase64!,
        }));
      }

      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setStatusSuccess(
        `Contact "${data.contact.fullName}" added (${
          isBeneficiary ? "Beneficiary " : ""
        }${isTrustedVerifier ? "Trusted Verifier" : ""})!`
      );
      await fetchDashboard();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to add contact.");
    }
  };

  // 6. Selective Beneficiary Wrapping (THE-101)
  const handleAssignItemToBeneficiary = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError("");
    setStatusSuccess("");
    setBeneficiaryTestOutput("");
    try {
      const contact = contacts.find((c) => c.id === selectedContactId);
      const decryptedItem = decryptedItems[selectedItemId];
      const rawItem = vault?.items?.find((i: any) => i.id === selectedItemId);

      if (!contact || !decryptedItem || !rawItem) {
        throw new Error("Select both an unlocked Vault Item and a Beneficiary.");
      }
      if (!contact.isBeneficiary || !contact.publicKeyBase64) {
        throw new Error(
          "Selected contact is a Verifier-only contact and cannot receive vault items."
        );
      }

      const wrappedGrant = await wrapItemKeyForBeneficiary({
        itemKeyBase64: decryptedItem.itemKeyBase64,
        beneficiaryPublicKeyBase64: contact.publicKeyBase64,
        vaultId: vault.id,
        contactId: contact.id,
        itemId: rawItem.aadResourceId,
        keyVersion: rawItem.keyVersion,
      });

      const res = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ASSIGN_ITEM_TO_BENEFICIARY",
          assignment: {
            contactId: contact.id,
            itemId: rawItem.id,
            beneficiaryWrappedKeyBase64: wrappedGrant.beneficiaryWrappedKeyBase64,
            beneficiaryWrappedKeyIv: wrappedGrant.beneficiaryWrappedKeyIv,
            ephemeralPublicKeyBase64: wrappedGrant.ephemeralPublicKeyBase64,
            keyVersion: wrappedGrant.keyVersion,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // If we have this beneficiary's private key in our test session, prove they can unwrap & decrypt it without the VMK!
      const privKey = localBeneficiaryPrivKeys[contact.id];
      if (privKey) {
        const verifiedDecrypt = await decryptAssignedItemAsBeneficiary<{
          title: string;
          content: string;
        }>({
          itemEnvelope: {
            ciphertextBase64: rawItem.ciphertextBase64,
            ivBase64: rawItem.ivBase64,
            aadContext: {
              vaultId: vault.id,
              resourceId: rawItem.aadResourceId,
              resourceType: "VAULT_ITEM",
              keyVersion: rawItem.keyVersion,
            },
          },
          wrappedGrant,
          beneficiaryPrivateKeyBase64: privKey,
        });
        setBeneficiaryTestOutput(
          `Verified ECDH P-256 Unwrap as ${contact.fullName}: Decrypted "${verifiedDecrypt.title}" without owner VMK!`
        );
      }

      setStatusSuccess(
        `Item selectively wrapped via ECDH P-256 for ${contact.fullName}!`
      );
      await fetchDashboard();
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Assignment failed.");
    }
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
        <div className="text-muted-foreground">Loading Dusk Vault...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-border bg-background/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center">
              <Shield strokeWidth={1.5} className="w-4 h-4 text-primary" />
            </div>
            <span className="text-xl font-bold tracking-tight">Dusk.</span>
          </Link>
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="border-primary/40 text-primary">
              Auth: {user.authProvider}
            </Badge>
            <ThemeToggle />
            <span className="text-sm text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {user.fullName || user.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={handleSignOut}
              title="Revoke session & sign out"
            >
              <LogOut strokeWidth={1.5} className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-10 max-w-6xl space-y-8">
        {statusError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-sm">
            {statusError}
          </div>
        )}
        {statusSuccess && (
          <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{statusSuccess}</span>
          </div>
        )}

        {/* Check-In Schedule Status Panel */}
        <Card className="border-primary/20 bg-card">
          <CardContent className="p-6 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="w-16 h-16 rounded-full border-2 border-primary flex items-center justify-center bg-background">
                <Clock strokeWidth={1.5} className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h2 className="text-xl font-bold">
                  Dead-Man&apos;s Switch State: {schedule?.state || "HEALTHY"}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Interval: {schedule?.intervalDays || 90} days • Grace Period:{" "}
                  {schedule?.gracePeriodDays || 14} days • Vault Status:{" "}
                  <span className="font-semibold text-foreground">
                    {!vault
                      ? "Not Initialized"
                      : unlockedVmkBase64
                      ? "Unlocked in Browser Memory"
                      : "Locked (Ciphertext Only)"}
                  </span>
                </p>
              </div>
            </div>
            {unlockedVmkBase64 && (
              <Button
                variant="outline"
                onClick={() => {
                  setUnlockedVmkBase64(null);
                  setDecryptedItems({});
                  setStatusSuccess("Vault Master Key wiped from browser memory.");
                }}
              >
                <Lock className="w-4 h-4 mr-2" /> Lock Vault Memory
              </Button>
            )}
          </CardContent>
        </Card>

        {/* STEP 1: Initialize or Unlock Vault */}
        {!vault ? (
          <Card className="bg-card border-primary/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5 text-primary" />
                Initialize Your Zero-Knowledge Vault (THE-98 & THE-99)
              </CardTitle>
              <CardDescription>
                Generates a 256-bit Vault Master Key in your browser, wraps it with PBKDF2-SHA256, and creates your offline Recovery Kit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInitializeVault} className="space-y-4 max-w-md">
                <div>
                  <label className="text-sm font-medium block mb-1">
                    Choose a Master Encryption Passphrase (min 8 chars)
                  </label>
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={masterPassphrase}
                    onChange={(e) => setMasterPassphrase(e.target.value)}
                    placeholder="Enter strong master passphrase..."
                  />
                </div>
                <Button type="submit">
                  <Shield className="w-4 h-4 mr-2" /> Generate Master Key & Recovery Kit
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : !unlockedVmkBase64 ? (
          <div className="grid md:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Unlock className="w-5 h-5 text-primary" /> Unlock with Master Passphrase
                </CardTitle>
                <CardDescription>
                  Unwraps your Vault Master Key locally using PBKDF2-SHA256.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUnlockWithPassphrase} className="space-y-4">
                  <Input
                    type="password"
                    required
                    value={masterPassphrase}
                    onChange={(e) => setMasterPassphrase(e.target.value)}
                    placeholder="Master Encryption Passphrase"
                  />
                  <Button type="submit" className="w-full">
                    Unlock Vault
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileKey className="w-5 h-5 text-primary" /> Recover with Offline Recovery Kit (THE-99)
                </CardTitle>
                <CardDescription>
                  Active Kit Fingerprint:{" "}
                  <code className="text-primary">
                    {recoveryArtifacts[0]?.fingerprintHex || "None"}
                  </code>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUnlockWithRecoveryKit} className="space-y-4">
                  <Input
                    type="text"
                    required
                    value={recoveryCodeInput}
                    onChange={(e) => setRecoveryCodeInput(e.target.value)}
                    placeholder="DUSK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                  />
                  <Button type="submit" variant="outline" className="w-full">
                    Recover Vault Master Key
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {/* Display Newly Generated Offline Recovery Kit */}
        {generatedKit && (
          <Card className="border-primary bg-primary/5">
            <CardHeader>
              <CardTitle className="text-primary flex items-center gap-2">
                <FileKey className="w-5 h-5" /> Save Your Offline Recovery Kit (THE-99)
              </CardTitle>
              <CardDescription>{generatedKit.warningNotice}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 font-mono text-sm">
              <div>
                <strong>Recovery Code (Copy this to test recovery!):</strong>{" "}
                <span className="text-primary select-all font-bold">
                  {generatedKit.recoveryCode}
                </span>
              </div>
              <div>
                <strong>Public Fingerprint:</strong> {generatedKit.fingerprintHex}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Workspace Tabs */}
        <Tabs defaultValue="vault" className="w-full">
          <TabsList className="w-full justify-start border-b border-border rounded-none bg-transparent h-auto p-0 space-x-6">
            <TabsTrigger value="vault" className="pb-3">
              <Key className="w-4 h-4 mr-2" /> Encrypted Vault (THE-98)
            </TabsTrigger>
            <TabsTrigger value="contacts" className="pb-3">
              <User className="w-4 h-4 mr-2" /> Beneficiaries & Verifiers (THE-100 & THE-101)
            </TabsTrigger>
            <TabsTrigger value="audit" className="pb-3">
              <Activity className="w-4 h-4 mr-2" /> Redacted Audit Log (THE-96)
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: VAULT ITEMS */}
          <TabsContent value="vault" className="mt-6 grid md:grid-cols-2 gap-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-primary" /> Encrypt & Add Secret
                </CardTitle>
                <CardDescription>
                  Encrypted in browser with a per-item 256-bit key (IEK) wrapped under your VMK.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleEncryptAndSaveItem} className="space-y-4">
                  <div>
                    <label className="text-xs font-medium block mb-1">Title</label>
                    <Input
                      required
                      disabled={!unlockedVmkBase64}
                      value={itemTitle}
                      onChange={(e) => setItemTitle(e.target.value)}
                      placeholder="e.g. Ledger Nano X Seed Phrase"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1">
                      Secret Payload
                    </label>
                    <Textarea
                      required
                      disabled={!unlockedVmkBase64}
                      value={itemSecretContent}
                      onChange={(e) => setItemSecretContent(e.target.value)}
                      placeholder="Enter seed phrase, password, or instructions..."
                      className="h-28"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={!unlockedVmkBase64}
                    className="w-full"
                  >
                    <Lock className="w-4 h-4 mr-2" />
                    {unlockedVmkBase64
                      ? "Encrypt Client-Side & Save to Neon Postgres"
                      : "Unlock Vault First to Add Secrets"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">
                  Persisted Encrypted Items ({vault?.items?.length || 0})
                </CardTitle>
                <CardDescription>
                  When locked, only opaque Base64 ciphertext from Neon Postgres is shown.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!vault?.items?.length ? (
                  <p className="text-sm text-muted-foreground">
                    No encrypted items stored yet.
                  </p>
                ) : (
                  vault.items.map((item: any) => {
                    const dec = decryptedItems[item.id];
                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-xl border border-border bg-background/50 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">
                            {dec ? dec.title : `Opaque Item (${item.id.slice(0, 10)}...)`}
                          </span>
                          <Badge variant="outline">
                            kv:{item.keyVersion} • {item.category}
                          </Badge>
                        </div>
                        {dec ? (
                          <p className="text-xs font-mono text-primary bg-primary/5 p-2 rounded">
                            Decrypted Plaintext: {dec.content}
                          </p>
                        ) : (
                          <p className="text-xs font-mono text-muted-foreground truncate">
                            Ciphertext: {item.ciphertextBase64}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 2: BENEFICIARIES, TRUSTED VERIFIERS & SELECTIVE WRAPPING */}
          <TabsContent value="contacts" className="mt-6 space-y-6">
            <div className="grid md:grid-cols-2 gap-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Add Beneficiary or Trusted Verifier (THE-100)
                  </CardTitle>
                  <CardDescription>
                    Roles are strictly separated. Beneficiaries automatically receive an ECDH P-256 keypair.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleAddContact} className="space-y-4">
                    <Input
                      required
                      placeholder="Full Name (e.g. Sarah Connor)"
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                    />
                    <Input
                      required
                      type="email"
                      placeholder="Email Address"
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                    <div className="flex items-center gap-6 text-sm pt-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isBeneficiary}
                          onChange={(e) => setIsBeneficiary(e.target.checked)}
                        />
                        <span>Beneficiary (Recipient)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isTrustedVerifier}
                          onChange={(e) => setIsTrustedVerifier(e.target.checked)}
                        />
                        <span>Trusted Verifier</span>
                      </label>
                    </div>
                    <Button type="submit" className="w-full">
                      <Plus className="w-4 h-4 mr-2" /> Add Contact
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-lg">
                    Selective Beneficiary Key Wrapping (THE-101)
                  </CardTitle>
                  <CardDescription>
                    Wraps a specific Item Key (IEK) to a Beneficiary&apos;s ECDH P-256 Public Key.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form
                    onSubmit={handleAssignItemToBeneficiary}
                    className="space-y-4"
                  >
                    <div>
                      <label className="text-xs font-medium block mb-1">
                        Select Unlocked Vault Item
                      </label>
                      <select
                        required
                        value={selectedItemId}
                        onChange={(e) => setSelectedItemId(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background p-2 text-sm"
                      >
                        <option value="">-- Choose Item --</option>
                        {vault?.items?.map((i: any) => (
                          <option key={i.id} value={i.id}>
                            {decryptedItems[i.id]?.title || i.id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1">
                        Select Contact
                      </label>
                      <select
                        required
                        value={selectedContactId}
                        onChange={(e) => setSelectedContactId(e.target.value)}
                        className="w-full rounded-lg border border-border bg-background p-2 text-sm"
                      >
                        <option value="">-- Choose Contact --</option>
                        {contacts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fullName} (
                            {c.isBeneficiary ? "Beneficiary" : "Verifier-Only"})
                          </option>
                        ))}
                      </select>
                    </div>
                    <Button
                      type="submit"
                      disabled={!unlockedVmkBase64}
                      className="w-full"
                    >
                      Wrap Item Key for Beneficiary
                    </Button>
                  </form>
                  {beneficiaryTestOutput && (
                    <div className="mt-4 p-3 rounded-lg bg-primary/10 border border-primary/30 text-xs font-mono text-primary">
                      {beneficiaryTestOutput}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">
                  Contacts & Selective Assignments ({assignments.length} active grants)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Roles</TableHead>
                      <TableHead>Assigned Items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.map((c) => {
                      const count = assignments.filter(
                        (a) => a.contactId === c.id
                      ).length;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.fullName}</TableCell>
                          <TableCell>{c.email}</TableCell>
                          <TableCell className="space-x-2">
                            {c.isBeneficiary && (
                              <Badge variant="default">Beneficiary</Badge>
                            )}
                            {c.isTrustedVerifier && (
                              <Badge variant="outline">Trusted Verifier</Badge>
                            )}
                          </TableCell>
                          <TableCell>{count} item(s)</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: AUDIT EVENTS */}
          <TabsContent value="audit" className="mt-6">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-lg">
                  Append-Only Security & Audit Timeline
                </CardTitle>
                <CardDescription>
                  Notice how passwords, tokens, and ciphertexts are automatically replaced with [REDACTED].
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {auditEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3 rounded-lg border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                  >
                    <div>
                      <span className="font-bold text-primary mr-2">
                        {ev.eventType}
                      </span>
                      <span className="text-muted-foreground">{ev.redactedMeta}</span>
                    </div>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(ev.createdAt).toLocaleTimeString()}
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