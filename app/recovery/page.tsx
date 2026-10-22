import Link from "next/link";
import { ArrowLeft, Shield, KeyRound, FileText, CheckCircle2 } from "lucide-react";
import { DuskLogo } from "@/components/landing/dusk-logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "Recovery guide | Dusk",
  description: "Learn how to use your recovery kit to restore access to your encrypted vault.",
};

export default function RecoveryPage() {
  return (
    <div className="min-h-screen bg-canvas text-foreground transition-colors flex flex-col">
      {/* Navigation Header */}
      <header className="h-[68px] bg-sunken border-b border-border px-6 sm:px-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <DuskLogo size={24} />
          <span className="hidden sm:inline text-[13px] text-foreground-muted">/</span>
          <span className="hidden sm:inline text-[14px] font-medium text-foreground-secondary">
            Recovery guide
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[8px] border border-border bg-elevated text-[13px] font-medium text-foreground hover:bg-hover transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to sign in</span>
          </Link>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 sm:py-16">
        <div className="text-left space-y-8">
          <div>
            <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-foreground-secondary mb-2 block">
              Recovery
            </span>
            <h1 className="text-[28px] sm:text-[36px] font-bold text-foreground tracking-tight">
              Restoring vault access
            </h1>
            <p className="text-[15px] sm:text-[16px] text-foreground-secondary mt-2 leading-relaxed">
              Your vault is encrypted on your device, so Dusk support and password resets cannot decrypt it. Here is how to regain access with your recovery kit.
            </p>
          </div>

          {/* Critical Notice */}
          <div className="p-4 sm:p-5 rounded-[12px] bg-accent-surface/40 border border-brand/25 flex items-start gap-3.5">
            <Shield className="w-5 h-5 text-accent-text shrink-0 mt-0.5" />
            <div className="text-[14px] leading-relaxed">
              <strong className="text-foreground font-semibold block mb-1">
                Your recovery kit
              </strong>
              <span className="text-foreground">
                Your vault is encrypted on your device with your master passphrase. Dusk never receives your passphrase or keys. Your recovery kit is the way to restore access if you lose your passphrase.
              </span>
            </div>
          </div>

          {/* Recovery Paths Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Path 1: Forgot Master Passphrase */}
            <div className="border border-border bg-card rounded-[12px] p-6 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-foreground dark:text-accent-text mb-4">
                  <KeyRound className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-[17px] font-semibold text-foreground mb-2">
                  Forgot your master passphrase?
                </h2>
                <p className="text-[13.5px] text-foreground-secondary leading-relaxed mb-4">
                  Sign in to your Dusk account. In your digital vault, select &quot;Lost your passphrase? Use your recovery kit&quot; and enter your recovery code.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/login"
                  className="w-full inline-flex items-center justify-center h-10 px-4 rounded-[8px] bg-brand text-on-brand hover:bg-brand-hover text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Sign in to access your vault
                </Link>
              </div>
            </div>

            {/* Path 2: Beneficiary Estate Access */}
            <div className="border border-border bg-card rounded-[12px] p-6 flex flex-col justify-between">
              <div>
                <div className="w-10 h-10 rounded-[10px] bg-elevated border border-border flex items-center justify-center text-foreground dark:text-accent-text mb-4">
                  <FileText className="w-5 h-5 stroke-[1.75]" />
                </div>
                <h2 className="text-[17px] font-semibold text-foreground mb-2">
                  Beneficiary access link
                </h2>
                <p className="text-[13.5px] text-foreground-secondary leading-relaxed mb-4">
                  If you received an access link after a verified release, open the exact URL provided by the vault owner with the private key fragment intact.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/security"
                  className="w-full inline-flex items-center justify-center h-10 px-4 rounded-[8px] border border-border bg-elevated text-foreground text-[13px] font-medium hover:bg-hover transition-colors"
                >
                  Read the beneficiary protocol
                </Link>
              </div>
            </div>
          </div>

          {/* Finding your Recovery Kit Guide */}
          <div className="border border-border bg-card rounded-[12px] p-6 sm:p-7 space-y-4">
            <h3 className="text-[17px] font-semibold text-foreground">
              Locating your recovery kit
            </h3>
            <div className="space-y-3 text-[14px] text-foreground-secondary">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                <span>
                  <strong>JSON bundle:</strong> Search your offline storage for a file named <code className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-elevated text-foreground dark:text-accent-text">dusk-recovery-kit-[timestamp].json</code>.
                </span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                <span>
                  <strong>Physical printout:</strong> Look for the 32-character recovery code formatted as <code className="text-[12px] font-mono px-1.5 py-0.5 rounded bg-elevated text-foreground dark:text-accent-text">DUSK-XXXX-XXXX-...</code> printed during onboarding.
                </span>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
                <span>
                  <strong>Passphrase vs. password:</strong> Your account password signs you in to Dusk; your master passphrase decrypts your vault on your device.
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
