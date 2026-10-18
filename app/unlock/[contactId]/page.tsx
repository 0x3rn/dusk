"use client";

import { useState, use } from "react";
import {
  Shield,
  LockOpen,
  AlertTriangle,
  KeyRound,
  CheckCircle2,
  Download,
  FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { decryptAssignedItemAsBeneficiary } from "@/lib/crypto/beneficiary-wrapping";

export default function UnlockPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = use(params);
  const [beneficiaryEmail, setBeneficiaryEmail] = useState("");
  const [accessToken, setAccessToken] = useState(() => {
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("token") || "";
    }
    return "";
  });
  const [privateKeyInput, setPrivateKeyInput] = useState(() => {
    if (typeof window !== "undefined") {
      return window.location.hash.replace("#", "");
    }
    return "";
  });

  const [isAttempting, setIsAttempting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grantEventId, setGrantEventId] = useState<string | null>(null);
  const [manifestHash, setManifestHash] = useState<string>("");
  const [rawPackage, setRawPackage] = useState<any>(null);
  const [decryptedSecrets, setDecryptedSecrets] = useState<
    Array<{ itemId: string; title: string; content: string; category: string }>
  >([]);
  const [acknowledged, setAcknowledged] = useState(false);

  const handleRetrieveAndDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAttempting(true);

    try {
      const privKey =
        privateKeyInput.trim() || window.location.hash.replace("#", "").trim();
      if (!privKey) {
        throw new Error(
          "Beneficiary Private Key is missing. Ensure it is in the URL #hash or pasted below."
        );
      }

      const res = await fetch(`/api/unlock/${contactId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "RETRIEVE_PACKAGE",
          rawAccessToken: accessToken.trim(),
          beneficiaryEmail: beneficiaryEmail.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Access denied.");
      }

      setGrantEventId(data.grantEventId);
      setManifestHash(data.manifestSha256Hex);
      setRawPackage(data);

      const results: Array<{
        itemId: string;
        title: string;
        content: string;
        category: string;
      }> = [];

      for (const item of data.items) {
        const plain = await decryptAssignedItemAsBeneficiary<{
          title: string;
          content: string;
        }>({
          itemEnvelope: {
            ciphertextBase64: item.ciphertextBase64,
            ivBase64: item.ivBase64,
            aadContext: {
              vaultId: item.vaultId,
              resourceId: item.aadResourceId,
              resourceType: "VAULT_ITEM",
              keyVersion: item.keyVersion,
            },
          },
          wrappedGrant: item.wrappedGrant,
          beneficiaryPrivateKeyBase64: privKey,
        });

        results.push({
          itemId: item.itemId,
          title: plain.title,
          content: plain.content,
          category: item.category,
        });
      }

      setDecryptedSecrets(results);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to authorize or decrypt beneficiary package."
      );
    } finally {
      setIsAttempting(false);
    }
  };

  const handleAcknowledgeReceipt = async () => {
    if (!grantEventId) return;
    try {
      const res = await fetch(`/api/unlock/${contactId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ACKNOWLEDGE_RECEIPT",
          grantEventId,
          beneficiaryEmail,
          decryptedCount: decryptedSecrets.length,
        }),
      });
      if (res.ok) {
        setAcknowledged(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDownloadEncryptedBundle = () => {
    if (!rawPackage) return;
    const blob = new Blob([JSON.stringify(rawPackage, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dusk-release-package-${contactId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="flex items-center gap-2 mb-8">
        <div className="w-10 h-10 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
          <Shield className="w-5 h-5 text-primary" />
        </div>
        <span className="text-3xl font-bold tracking-tight">Dusk.</span>
      </div>

      <Card className="w-full max-w-2xl bg-card border-border">
        <CardHeader className="text-center pb-6 border-b border-border">
          <div className="mx-auto w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            {error ? (
              <AlertTriangle className="w-7 h-7 text-destructive" />
            ) : (
              <LockOpen className="w-7 h-7 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            Emergency Estate Release Access (THE-104 & THE-105)
          </CardTitle>
          <CardDescription>
            Scoped Beneficiary ID: <code className="text-primary">{contactId}</code>
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {error && (
            <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-xl text-center text-destructive text-sm font-medium">
              {error}
            </div>
          )}

          {!decryptedSecrets.length && !rawPackage ? (
            <form onSubmit={handleRetrieveAndDecrypt} className="space-y-4">
              <div>
                <label className="text-xs font-medium block mb-1">
                  Verify Your Beneficiary Email Address
                </label>
                <Input
                  type="email"
                  required
                  value={beneficiaryEmail}
                  onChange={(e) => setBeneficiaryEmail(e.target.value)}
                  placeholder="sarah@example.com"
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">
                  Single-Use Release Access Grant Token
                </label>
                <Input
                  type="text"
                  required
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder="Paste single-use access grant token..."
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1">
                  Beneficiary Private Key (Client-Only; Never Sent to Server)
                </label>
                <Input
                  type="text"
                  required
                  value={privateKeyInput}
                  onChange={(e) => setPrivateKeyInput(e.target.value)}
                  placeholder="Base64 PKCS#8 Private Key (or via URL #hash)"
                />
              </div>
              <Button type="submit" disabled={isAttempting} className="w-full h-11">
                <KeyRound className="w-4 h-4 mr-2" />
                {isAttempting
                  ? "Verifying Grant & Decrypting Locally..."
                  : "Verify Grant & Decrypt Assigned Package"}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-primary/10 border border-primary/30 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-primary font-medium">
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                  <span>
                    Decrypted {decryptedSecrets.length} Assigned Item(s) Locally
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadEncryptedBundle}
                  >
                    <Download className="w-4 h-4 mr-1" /> Download Encrypted Bundle
                  </Button>
                  {!acknowledged ? (
                    <Button size="sm" onClick={handleAcknowledgeReceipt}>
                      <FileCheck className="w-4 h-4 mr-1" /> Acknowledge Receipt
                    </Button>
                  ) : (
                    <span className="text-xs text-primary font-semibold">
                      ✓ Receipt Acknowledged
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs font-mono text-muted-foreground break-all">
                Package SHA-256 Manifest: {manifestHash}
              </div>

              <div className="space-y-4">
                {decryptedSecrets.map((sec) => (
                  <div
                    key={sec.itemId}
                    className="p-5 rounded-xl border border-border bg-background space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-base text-primary">
                        {sec.title}
                      </h3>
                      <span className="text-xs text-muted-foreground font-mono">
                        {sec.category}
                      </span>
                    </div>
                    <p className="font-mono text-sm text-foreground whitespace-pre-wrap">
                      {sec.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border pt-4 text-xs text-muted-foreground">
          Zero-Knowledge Architecture • Scoped ECDH P-256 + AES-256-GCM Client Decryption
        </CardFooter>
      </Card>
    </div>
  );
}