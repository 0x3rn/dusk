// app/(marketing)/security/page.tsx
import Link from "next/link";
import {
  Shield,
  Lock,
  Key,
  ServerOff,
  GitBranch,
  UserCheck,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import {
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";
import { LEGAL_SCOPE_AND_ESTATE_DISCLAIMER } from "@/lib/security/http-hardening";

export const metadata = {
  title: "Security Architecture & Zero-Knowledge Whitepaper | Dusk",
  description:
    "How Dusk protects your vault using client-side AES-256-GCM encryption, HKDF key hierarchies, ECDH P-256 selective beneficiary wrapping, and a fail-closed release state machine.",
};

export default async function SecurityArchitecturePage() {
  const token = await getSessionTokenFromRequest();
  let isAuthenticated = false;

  if (token) {
    try {
      const service = getFoundationService();
      await service.authenticateSession(token);
      isAuthenticated = true;
    } catch {
      isAuthenticated = false;
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/20">
      {/* Navbar */}
      <nav className="border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-xl font-bold tracking-tight">
              Dusk
            </Link>
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft strokeWidth={1.5} className="w-4 h-4" /> Back to Home
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors px-5 py-2 rounded-md text-sm flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Go to Dashboard <ArrowRight strokeWidth={1.5} className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium hover:text-foreground transition-colors hidden sm:block"
                >
                  Sign In
                </Link>
                <Link
                  href="/register"
                  className="bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors px-5 py-2 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-6 py-20 max-w-4xl space-y-20">
        {/* Header */}
        <header className="space-y-6 border-b border-border pb-12">
          <Badge
            variant="outline"
            className="border-brand/25 text-accent-text bg-accent-surface px-3 py-1"
          >
            Technical Security Whitepaper • v1.0
          </Badge>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tighter leading-tight">
            Dusk Zero-Knowledge Security Architecture
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
            Dusk is engineered under a single foundational assumption:{" "}
            <strong className="text-foreground">
              our servers, databases, and operators must never have the ability
              to decrypt your vault.
            </strong>{" "}
            This document details the cryptographic primitives, key hierarchy,
            trust boundaries, and fail-closed state machines that enforce this
            guarantee.
          </p>
        </header>

        {/* Section 1: Trust Boundary */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-surface border border-brand/25 flex items-center justify-center">
              <ServerOff strokeWidth={1.5} className="w-5 h-5 text-accent-text" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              1. Client / Server Trust Boundary
            </h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            All key generation, key derivation, payload encryption, and file
            encryption occur exclusively inside your browser using the native{" "}
            <code className="text-foreground font-mono text-sm">
              W3C Web Crypto API (window.crypto.subtle)
            </code>
            . Plaintext data never leaves your device.
          </p>

          <div className="grid md:grid-cols-2 gap-6 pt-2">
            <div className="border border-brand/25 bg-accent-surface/40 rounded-2xl p-6 space-y-3">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Lock strokeWidth={1.5} className="w-4 h-4 text-accent-text" />
                Client-Side Only (Never Sent to Server)
              </h3>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                <li>Your Master Encryption Passphrase</li>
                <li>Unwrapped 256-bit Vault Master Key (VMK)</li>
                <li>Unwrapped Per-Item (IEK) and Per-File (FEK) Keys</li>
                <li>Plaintext titles, credentials, seed phrases, and notes</li>
                <li>Plaintext folder names and search queries</li>
                <li>Your Offline Recovery Code (DUSK-XXXX-...)</li>
                <li>Beneficiary ECDH P-256 Private Keys (#hash fragment)</li>
              </ul>
            </div>

            <div className="border border-border bg-card rounded-2xl p-6 space-y-3">
              <h3 className="font-bold text-foreground flex items-center gap-2">
                <Shield strokeWidth={1.5} className="w-4 h-4 text-muted-foreground" />
                Server-Side Coordination (PostgreSQL)
              </h3>
              <ul className="text-sm text-muted-foreground space-y-2 list-disc list-inside">
                <li>Opaque AES-256-GCM ciphertexts &amp; 96-bit IVs</li>
                <li>PBKDF2/HKDF wrapped key envelopes &amp; salts</li>
                <li>Beneficiary SPKI Public Keys &amp; ECDH wrapped grants</li>
                <li>Check-in timers and release state machine</li>
                <li>SHA-256 digests of single-use session &amp; action tokens</li>
                <li>Append-only, secret-redacted security audit logs</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 2: Key Hierarchy */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-surface border border-brand/25 flex items-center justify-center">
              <Key strokeWidth={1.5} className="w-5 h-5 text-accent-text" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              2. Multi-Tier Cryptographic Key Hierarchy
            </h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Dusk never encrypts vault items directly with a password. Instead,
            we use a multi-tier key hierarchy that enables instant passphrase
            rotation, recovery kit restoration, and granular per-item
            beneficiary sharing without re-encrypting your entire vault.
          </p>

          <div className="border border-border bg-card rounded-2xl p-6 font-mono text-xs md:text-sm space-y-3 overflow-x-auto">
            <div className="text-accent-text font-semibold">
              [User Master Passphrase] + [16-Byte CSPRNG Salt]
            </div>
            <div className="pl-4 text-muted-foreground">
              └── PBKDF2-HMAC-SHA256 (600,000 Iterations) ──►{" "}
              <span className="text-foreground">
                256-bit Passphrase Key Encryption Key (KEK)
              </span>
            </div>
            <div className="pl-10 text-muted-foreground">
              └── AES-256-GCM Wraps ──►{" "}
              <span className="text-accent-text font-semibold">
                256-bit Vault Master Key (VMK)
              </span>
            </div>
            <div className="pl-16 text-muted-foreground">
              ├── HKDF-SHA256 (&quot;dusk-v1-item-kek&quot;) ──► Wraps unique
              256-bit <span className="text-foreground">Item Keys (IEK)</span>
            </div>
            <div className="pl-16 text-muted-foreground">
              ├── HKDF-SHA256 (&quot;dusk-v1-file-kek&quot;) ──► Wraps unique
              256-bit <span className="text-foreground">File Keys (FEK)</span>
            </div>
            <div className="pl-16 text-muted-foreground">
              └── HKDF-SHA256 (&quot;dusk-v1-folder-key&quot;) ──► Encrypts{" "}
              <span className="text-foreground">Vault Folder Names</span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div className="border border-border rounded-xl p-5 bg-card">
              <h4 className="font-bold mb-1">
                Contextual AAD Integrity Binding
              </h4>
              <p className="text-muted-foreground">
                Every AES-256-GCM encryption binds canonical Additional
                Authenticated Data (
                <code className="text-xs">
                  dusk-aad-v1|vaultId|resourceType|resourceId|kv:N
                </code>
                ) into the 128-bit GCM authentication tag, preventing cross-item
                or cross-vault ciphertext substitution attacks.
              </p>
            </div>
            <div className="border border-border rounded-xl p-5 bg-card">
              <h4 className="font-bold mb-1">
                Recovery kit (Crockford Base32)
              </h4>
              <p className="text-muted-foreground">
                Your 256-bit VMK is independently wrapped under your recovery
                code (<code className="text-xs">DUSK-XXXX-...</code>)
                that only you hold offline. If you lose your master passphrase,
                your recovery kit restores your VMK locally and revokes all
                prior device sessions.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3: Selective Beneficiary Wrapping */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-surface border border-brand/25 flex items-center justify-center">
              <GitBranch strokeWidth={1.5} className="w-5 h-5 text-accent-text" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              3. Selective Beneficiary Key Wrapping (ECDH P-256)
            </h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Different beneficiaries often require access to different parts of a
            digital estate. Sharing a single vault key would expose every secret
            to every contact. Dusk enforces{" "}
            <strong className="text-foreground">
              mathematical cross-beneficiary isolation
            </strong>
            :
          </p>
          <ul className="space-y-3 text-sm text-muted-foreground list-disc list-inside">
            <li>
              Each Beneficiary has a dedicated{" "}
              <strong className="text-foreground">ECDH P-256</strong> asymmetric
              keypair. Only the public key (SPKI) is stored on Dusk servers.
            </li>
            <li>
              When you assign Item A to Beneficiary 1, your browser generates a{" "}
              <strong className="text-foreground">
                fresh one-time ephemeral ECDH keypair
              </strong>
              , performs elliptic-curve Diffie-Hellman key agreement with
              Beneficiary 1&apos;s public key, derives a scoped wrapping key via{" "}
              <code className="text-foreground">HKDF-SHA256</code>, and wraps{" "}
              <em>only</em> Item A&apos;s 256-bit Item Encryption Key.
            </li>
            <li>
              Beneficiary 1 cannot decrypt Item B (assigned to Beneficiary 2) or
              any unassigned items in your vault, and never receives your Vault
              Master Key.
            </li>
          </ul>
        </section>

        {/* Section 4: Staged release state machine */}
        <section className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-surface border border-brand/25 flex items-center justify-center">
              <UserCheck strokeWidth={1.5} className="w-5 h-5 text-accent-text" />
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">
              4. Fail-Closed Check-In and Release State Machine
            </h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">
              A missed email is not proof of death.
            </strong>{" "}
            Dusk never releases a vault from an inactivity timer alone. Every
            schedule progresses through a strictly audited, idempotent state
            machine with multiple off-ramps:
          </p>

          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 1</div>
              <div className="font-bold mb-1">HEALTHY &amp; REMINDER_DUE</div>
              <p className="text-xs text-muted-foreground">
                Normal check-in countdown (e.g., 90 days) with pre-due email
                reminders. Any check-in immediately resets the timer.
              </p>
            </div>
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 2</div>
              <div className="font-bold mb-1">GRACE_PERIOD</div>
              <p className="text-xs text-muted-foreground">
                Configurable buffer window after a missed due date before
                escalation begins.
              </p>
            </div>
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 3</div>
              <div className="font-bold mb-1">ESCALATION_PENDING</div>
              <p className="text-xs text-muted-foreground">
                Multi-channel Email + SMS fallback warnings. If providers have
                an outage, the timer fails closed and refuses to advance.
              </p>
            </div>
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 4</div>
              <div className="font-bold mb-1">VERIFICATION_REQUIRED</div>
              <p className="text-xs text-muted-foreground">
                Trusted Verifiers (who do not receive vault secrets) can attest
                that you are alive to stop a false alarm, or approve release.
              </p>
            </div>
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 5</div>
              <div className="font-bold mb-1">RELEASE_HOLD</div>
              <p className="text-xs text-muted-foreground">
                Immediate freeze state if you or a Trusted Verifier flags a
                medical recovery, travel delay, or contested trigger.
              </p>
            </div>
            <div className="border border-border rounded-xl p-4 bg-card">
              <div className="text-xs font-mono text-accent-text mb-1">STAGE 6</div>
              <div className="font-bold mb-1">SCOPED RELEASE</div>
              <p className="text-xs text-muted-foreground">
                Only after all grace windows, confirmed deliveries, and verifier
                quorum rules pass are time-bounded, single-use beneficiary
                grants issued.
              </p>
            </div>
          </div>
        </section>

        {/* Section 5: Legal Scope Disclaimer */}
        <section className="border border-border bg-card rounded-2xl p-8 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle
              strokeWidth={1.5}
              className="w-5 h-5 text-accent-text shrink-0"
            />
            <h3 className="text-lg font-bold">
              Legal Scope &amp; Zero-Knowledge Custody Notice
            </h3>
          </div>
          <p className="text-sm font-semibold text-foreground">
            {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.notALegalWillHeadline}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.zeroKnowledgeCustodyNotice}
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.estatePlanningGuidance}
          </p>
        </section>
      </main>
    </div>
  );
}