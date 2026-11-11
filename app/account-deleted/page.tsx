import type { Metadata } from "next";
import Link from "next/link";

import { DuskLogo } from "@/components/landing/dusk-logo";
import { buttonPrimaryClass, buttonSecondaryClass } from "@/components/ui/form-field";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false, follow: false },
};

/** Shown after someone deletes their account. Public, static, and holds no personal information. */
export default function AccountDeletedPage() {
  return (
    <main className="min-h-dvh bg-canvas flex flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="mb-8">
        <DuskLogo size={28} />
      </div>
      <div className="w-full max-w-md border border-border bg-card rounded-2xl p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-3">Your account is deleted</h1>
        <p className="text-[15px] text-foreground-secondary mb-3">
          We deleted your Dusk account, your encrypted vault, the people you added, and your check-in plan. You are
          signed out on every device.
        </p>
        <p className="text-[15px] text-foreground-secondary mb-3">
          Nothing will be sent to the people you named, and we can&apos;t restore any of it. Copies in our database
          backups are removed as the backups age out, within 30 days.
        </p>
        <p className="text-[15px] text-foreground-secondary mb-6">
          You can use the same email address to start a new, empty account whenever you like.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Link href="/" className={`${buttonPrimaryClass} w-full sm:w-auto`}>
            Go to home page
          </Link>
          <Link href="/register" className={`${buttonSecondaryClass} w-full sm:w-auto`}>
            Create a new account
          </Link>
        </div>
      </div>
    </main>
  );
}
