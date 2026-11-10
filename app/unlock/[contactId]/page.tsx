"use client";

import { useState, use } from "react";
import {
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
import { DuskLogo } from "@/components/landing/dusk-logo";
import { decryptAssignedItemAsBeneficiary } from "@/lib/crypto/beneficiary-wrapping";
import { formatCount } from "@/lib/display-format";
import { categoryLabel } from "@/components/dashboard/item-categories";
import { Notice } from "@/components/ui/notice";
import { CryptoTamperOrAuthError } from "@/lib/crypto/vault-crypto";
import { fieldHintClass, fieldInputClass, fieldLabelClass } from "@/components/ui/form-field";

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
  const [rawPackage, setRawPackage] = useState<unknown>(null);
  const [decryptedSecrets, setDecryptedSecrets] = useState<
    Array<{ itemId: string; title: string; content: string; category: string }>
  >([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [ackError, setAckError] = useState(false);

  const handleRetrieveAndDecrypt = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsAttempting(true);

    try {
      const privKey =
        privateKeyInput.trim() || window.location.hash.replace("#", "").trim();
      if (!privKey) {
        throw new Error(
          "Your unlock key is missing. Use the full link you were given, or paste the key below."
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
        throw new Error(
                  data.error ||
                    "We couldn't open these items. Check your email address and access code, then try again."
                );
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
      const fallback =
        "We couldn't open these items. Check the three details above and try again. If this keeps happening, ask the person who sent you the link.";
      setError(
        err instanceof Error && !(err instanceof CryptoTamperOrAuthError) ? err.message : fallback
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
        setAckError(false);
        setAcknowledged(true);
      } else {
        setAckError(true);
      }
    } catch (err) {
      console.error(err);
      setAckError(true);
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
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>

      <Card className="w-full max-w-2xl bg-card border-border">
        <CardHeader className="text-center pb-6 border-b border-border">
          <div className="mx-auto w-14 h-14 rounded-full bg-accent-surface flex items-center justify-center mb-4">
            {error ? (
              <AlertTriangle className="w-7 h-7 text-destructive" aria-hidden="true" />
            ) : (
              <LockOpen className="w-7 h-7 text-accent-text" aria-hidden="true" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            <h1>Open the items shared with you</h1>
          </CardTitle>
          <CardDescription className="text-sm leading-relaxed">
            Someone chose you to receive items from their Dusk vault. Fill in the three boxes below to open them. Everything is opened on this device. Dusk never sees what is inside.
          </CardDescription>
        </CardHeader>

        <CardContent className="pt-6 space-y-6">
          {error && <Notice tone="error">{error}</Notice>}

          {!decryptedSecrets.length && !rawPackage ? (
            <form onSubmit={handleRetrieveAndDecrypt} className="space-y-4">
              <div>
                <label htmlFor="unlock-email" className={fieldLabelClass}>
                  Your email address
                </label>
                <input
                  id="unlock-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={beneficiaryEmail}
                  onChange={(e) => setBeneficiaryEmail(e.target.value)}
                  aria-describedby="unlock-email-hint"
                  className={fieldInputClass}
                />
                <span id="unlock-email-hint" className={fieldHintClass}>
                  The address the owner gave Dusk for you.
                </span>
              </div>
              <div>
                <label htmlFor="unlock-token" className={fieldLabelClass}>
                  Access code
                </label>
                <input
                  id="unlock-token"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  aria-describedby="unlock-token-hint"
                  className={fieldInputClass}
                />
                <span id="unlock-token-hint" className={fieldHintClass}>
                  Sent to you by Dusk when the release was confirmed. It works once.
                </span>
              </div>
              <div>
                <label htmlFor="unlock-key" className={fieldLabelClass}>
                  Your unlock key
                </label>
                <input
                  id="unlock-key"
                  type="text"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  value={privateKeyInput}
                  onChange={(e) => setPrivateKeyInput(e.target.value)}
                  aria-describedby="unlock-key-hint"
                  className={`${fieldInputClass} font-mono text-[13px]`}
                />
                <span id="unlock-key-hint" className={fieldHintClass}>
                  This is the long part of the link the owner gave you, after the # sign. If you opened that full link, it is already filled in. It never leaves this device.
                </span>
              </div>
              <Button type="submit" disabled={isAttempting} className="w-full h-11 text-[15px]">
                <KeyRound className="w-4 h-4 mr-2" aria-hidden="true" />
                {isAttempting ? "Opening..." : "Open my items"}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-accent-surface border border-brand/25 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-accent-text font-medium">
                  <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span role="status">
                    Opened {formatCount(decryptedSecrets.length, "item")} for you
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleDownloadEncryptedBundle}
                  >
                    <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Save an encrypted copy
                  </Button>
                  {!acknowledged ? (
                    <Button size="sm" onClick={handleAcknowledgeReceipt}>
                      <FileCheck className="w-4 h-4 mr-1" aria-hidden="true" /> Tell Dusk I received these
                    </Button>
                  ) : (
                    <span className="text-sm text-accent-text font-semibold">
                      Receipt confirmed
                    </span>
                  )}
                </div>
              </div>

              {ackError && (
                <Notice tone="error">
                  We couldn&apos;t record that you received these items. Your items are still open on this page. Try again in a moment.
                </Notice>
              )}

              <details className="text-sm text-muted-foreground">
                <summary className="cursor-pointer select-none hover:text-foreground">
                  Technical check code
                </summary>
                <p className="mt-2 text-xs font-mono break-all">{manifestHash}</p>
              </details>

              <div className="space-y-4">
                {decryptedSecrets.map((sec) => (
                  <div
                    key={sec.itemId}
                    className="p-5 rounded-xl border border-border bg-background space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="font-bold text-base text-foreground">
                        {sec.title}
                      </h2>
                      <span className="text-sm text-muted-foreground">
                        {categoryLabel(sec.category)}
                      </span>
                    </div>
                    <p className="font-mono text-[14px] text-foreground whitespace-pre-wrap break-words">
                      {sec.content}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-center border-t border-border pt-4 text-sm text-muted-foreground">
          Opened on this device. Dusk never sees what is inside.
        </CardFooter>
      </Card>
    </main>
  );
}