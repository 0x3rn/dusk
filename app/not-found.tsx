import Link from "next/link";

import { DuskLogo } from "@/components/landing/dusk-logo";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui/form-field";

export default function NotFound() {
  return (
    <main className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-2">
          We can&apos;t find that page
        </h1>
        <p className="text-sm text-foreground-secondary mb-6">
          The link may be old or mistyped. If someone sent you a Dusk link, ask them to send it again.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className={buttonPrimaryClass}>
            Go to home page
          </Link>
          <Link href="/login" className={buttonSecondaryClass}>
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
