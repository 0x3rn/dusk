"use client";

import { useEffect, useState, use } from "react";
import { Shield, LockOpen, AlertTriangle, KeyRound, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { decryptVaultData } from "@/lib/crypto";

// Mock encrypted payload (simulating what we'd pull from Firestore)
// In a real scenario, this would be fetched from the DB based on the contactId.
const MOCK_CIPHERTEXT = "DUMMY_CIPHERTEXT";
const MOCK_IV = "DUMMY_IV";
const MOCK_IS_UNLOCKED = true; // In reality, this is the Firebase flag

export default function UnlockPage({ params }: { params: Promise<{ contactId: string }> }) {
  const unwrappedParams = use(params);
  const contactId = unwrappedParams.contactId;
  const [decryptedData, setDecryptedData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAttempting, setIsAttempting] = useState(false);

  useEffect(() => {
    // The key is in the URL hash fragment. It is NOT sent to the server.
    const hash = window.location.hash.replace("#", "");
    
    if (!hash) {
      setError("Decryption key is missing from the URL. Please ensure you clicked the exact link provided in your email.");
      return;
    }

    if (!MOCK_IS_UNLOCKED) {
      setError("This vault is currently locked. The user's Dead Man's Switch has not been triggered.");
      return;
    }

    // In a real implementation we would fetch the vault document using the contactId.
    // For now we simulate attempting to decrypt a mock string. We will just show a mock success
    // if the key is present, because our DUMMY_CIPHERTEXT cannot actually be decrypted.
    
    const attemptDecryption = async () => {
      setIsAttempting(true);
      try {
        // Real logic:
        // const vaultDoc = await fetchVault(contactId);
        // const payload = await decryptVaultData(vaultDoc.ciphertext, vaultDoc.iv, hash);
        // setDecryptedData(payload);

        // Mock logic: simulating decryption delay
        await new Promise(res => setTimeout(res, 1500));
        setDecryptedData({
          secrets: [
            { title: "Ledger Seed Phrase", content: "apple banana cherry dog elephant fox grape..." },
            { title: "Final Wishes", content: "Please ensure my digital assets go to..." }
          ]
        });
      } catch (err) {
        console.error(err);
        setError("Failed to decrypt the vault. The key may be invalid or the payload corrupted.");
      } finally {
        setIsAttempting(false);
      }
    };

    attemptDecryption();
  }, [contactId]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-1/4 left-1/4 w-[400px] h-[400px] bg-primary/20 rounded-full blur-[100px] -z-10 pointer-events-none" />

      <div className="flex items-center gap-2 mb-8">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary/40 flex items-center justify-center shadow-[0_0_15px_rgba(var(--primary),0.5)]">
          <Shield className="w-5 h-5 text-background" />
        </div>
        <span className="text-3xl font-bold tracking-tight">Dusk.</span>
      </div>

      <Card className="w-full max-w-2xl bg-background/50 backdrop-blur-xl border-white/10 shadow-2xl">
        <CardHeader className="text-center pb-8 border-b border-white/5">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            {error ? <AlertTriangle className="w-8 h-8 text-destructive" /> : <LockOpen className="w-8 h-8 text-primary" />}
          </div>
          <CardTitle className="text-2xl font-bold">Emergency Vault Access</CardTitle>
          <CardDescription className="text-base mt-2">
            You are attempting to access a secure digital estate vault.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="pt-8">
          {error ? (
            <div className="p-6 bg-destructive/10 border border-destructive/20 rounded-xl text-center">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-4" />
              <p className="text-destructive font-medium">{error}</p>
            </div>
          ) : isAttempting ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-6">
              <KeyRound className="w-12 h-12 text-primary animate-pulse" />
              <div className="space-y-2 text-center">
                <p className="font-medium text-lg">Decrypting Vault...</p>
                <p className="text-sm text-muted-foreground">Applying your local URL key to the AES-256 payload.</p>
              </div>
            </div>
          ) : decryptedData ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="flex items-center justify-center gap-2 text-green-500 mb-8">
                <CheckCircle2 className="w-6 h-6" />
                <span className="font-medium text-lg">Decryption Successful</span>
              </div>
              
              <div className="space-y-4">
                {decryptedData.secrets.map((secret: any, idx: number) => (
                  <div key={idx} className="p-6 rounded-xl border border-white/10 bg-black/40">
                    <h3 className="font-bold text-lg mb-4 text-primary">{secret.title}</h3>
                    <p className="font-mono text-sm text-muted-foreground whitespace-pre-wrap">{secret.content}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
        
        <CardFooter className="flex justify-center border-t border-white/5 pt-6 text-sm text-muted-foreground">
          Zero-Knowledge Architecture • True Client-Side Decryption
        </CardFooter>
      </Card>
    </div>
  );
}
