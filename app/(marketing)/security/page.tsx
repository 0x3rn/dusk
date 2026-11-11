// app/(marketing)/security/page.tsx
// The public security page. It is written for a worried family member first: what is protected,
// what happens if you stop checking in, and who can ever see what. The exact methods and settings
// follow in "Technical details" (technical-details.tsx). Check every claim against lib/crypto and
// lib/engine before changing it.
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { SiteFooter } from "@/components/landing/site-footer";
import { isSignedIn } from "@/lib/auth/current-user";
import { LEGAL_SCOPE_AND_ESTATE_DISCLAIMER } from "@/lib/security/http-hardening";
import { TechnicalDetails } from "./technical-details";

export const metadata = {
  title: "How Dusk keeps your vault private | Dusk",
  description:
    "In plain words: what Dusk protects, what happens if you stop checking in, and who can see what. Exact technical details are at the end of the page.",
};

// Reads the signed-in session, so it must render per request, never at build time.
export const dynamic = "force-dynamic";

const SECTION_LINKS = [
  { href: "#what-is-protected", label: "What is protected" },
  { href: "#who-sees-what", label: "Who can see what" },
  { href: "#if-you-stop-checking-in", label: "If you stop checking in" },
  { href: "#limits", label: "What Dusk can't do" },
  { href: "#technical-details", label: "Technical details" },
];

const WHO_SEES_WHAT: ReadonlyArray<{ who: string; sees: string }> = [
  {
    who: "You",
    sees: "Everything in your vault, once you unlock it on your own device with your master passphrase.",
  },
  {
    who: "Dusk and the companies that help us run it",
    sees: "Scrambled data they cannot open, plus the facts listed above. Never your titles, notes, passwords, folder names or master passphrase.",
  },
  {
    who: "Your trusted verifiers",
    sees: "A request to confirm that you are okay, or that a release is real. They never receive anything from your vault.",
  },
  {
    who: "Your beneficiaries",
    sees: "Only the items you set aside for them, and only after a release is confirmed. They open those on their own device with the private link you gave them. Items you did not set aside for them stay locked, even to them.",
  },
];

const STEPS: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: "Reminders",
    text: "Before your check-in is due, Dusk emails you a reminder with a link. Opening the link is your check-in, and your timer starts again.",
  },
  {
    title: "A grace period",
    text: "If the date passes, you get extra time and more reminders. You choose how long; the default is 14 days. Nobody else is contacted yet.",
  },
  {
    title: "Final warnings",
    text: "After the grace period, Dusk sends stronger warnings for 7 more days. It will not go on until several reminders have been sent and at least one was delivered, so an email problem on our side can never start a release.",
  },
  {
    title: "Your trusted verifiers are asked",
    text: "Only now does Dusk contact the verifiers you chose. Each gets a private link to say either that you are okay, or that a release is real. If any verifier says you are okay, the process stops. You decide how many must agree; the default is one.",
  },
  {
    title: "Release, only if every rule is met",
    text: "Each beneficiary is then emailed an access link that works once and expires after 48 hours. They also need the private link you gave them, and they can open only the items you set aside for them.",
  },
];

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-3xl font-semibold tracking-tight text-foreground">
      {children}
    </h2>
  );
}

const body = "text-[16px] leading-relaxed text-foreground-secondary";

export default async function SecurityPage() {
  const isAuthenticated = await isSignedIn();

  return (
    <div className="min-h-dvh bg-background text-foreground selection:bg-primary/20">
      {/* Navbar */}
      <nav className="border-b border-border sticky top-0 z-50 bg-background/80 backdrop-blur-md">
        <div className="container mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="inline-flex min-h-11 items-center text-xl font-bold tracking-tight">
              Dusk
            </Link>
            <Link
              href="/"
              className="hidden sm:flex min-h-11 whitespace-nowrap text-sm text-muted-foreground hover:text-foreground items-center gap-1.5 transition-colors"
            >
              <ArrowLeft strokeWidth={1.5} className="w-4 h-4" aria-hidden="true" /> Back to home
            </Link>
          </div>
          <div className="flex items-center gap-1 sm:gap-4">
            {isAuthenticated ? (
              <Link
                href="/dashboard"
                className="bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors px-4 sm:px-5 min-h-11 whitespace-nowrap rounded-md text-sm flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                Dashboard <ArrowRight strokeWidth={1.5} className="w-4 h-4" aria-hidden="true" />
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm font-medium hover:text-foreground transition-colors hidden sm:inline-flex min-h-11 items-center px-2"
                >
                  Sign in
                </Link>
                <Link
                  href="/register"
                  className="bg-brand text-on-brand hover:bg-brand-hover font-semibold transition-colors px-4 sm:px-5 min-h-11 inline-flex items-center whitespace-nowrap rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Get Dusk
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="container mx-auto px-4 sm:px-6 py-12 sm:py-20 max-w-3xl space-y-14 sm:space-y-20">
        {/* Header */}
        <header className="space-y-6 border-b border-border pb-10">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight">
            How Dusk keeps your vault private
          </h1>
          <p className="text-lg text-foreground-secondary leading-relaxed max-w-prose">
            Dusk keeps the things your family would need if something happened to you: logins, instructions and notes. This
            page explains in plain words what is protected, what happens if you stop checking in, and who can see what. The
            exact methods are at the end, under Technical details.
          </p>
          <nav aria-label="On this page">
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
              {SECTION_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="inline-flex min-h-11 items-center text-accent-text underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-sm"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {/* 1. What is protected */}
        <section aria-labelledby="what-is-protected" className="space-y-5">
          <SectionHeading id="what-is-protected">What is protected</SectionHeading>
          <p className={body}>
            Everything you put in your vault is locked on your own device before it is sent to us. The key that locks it is
            made from your master passphrase, and your passphrase never leaves your device. What we store is scrambled text
            that only your passphrase can turn back into words.
          </p>
          <ul className="list-disc pl-5 space-y-3 text-[16px] leading-relaxed text-foreground-secondary marker:text-foreground-muted">
            <li>
              <strong className="text-foreground">We can&apos;t read it.</strong> Not our staff, not the companies that help
              us run Dusk, not our systems. If someone stole our database, or asked us to hand your vault over, all we or
              they would have is scrambled text.
            </li>
            <li>
              <strong className="text-foreground">We can&apos;t reset your passphrase.</strong> If you lose both your
              passphrase and your recovery code, nobody can open your vault. Set up your recovery kit and keep it somewhere
              safe.
            </li>
            <li>
              <strong className="text-foreground">What we can see.</strong> That an item exists, what type it is (for
              example a login or a note), when you added or changed it, and which person you set it aside for. We also have
              your email address, the names and emails of the people you add, and your check-in schedule.
            </li>
          </ul>
        </section>

        {/* 2. Who can see what */}
        <section aria-labelledby="who-sees-what" className="space-y-5">
          <SectionHeading id="who-sees-what">Who can see what</SectionHeading>
          <dl className="divide-y divide-border border-y border-border">
            {WHO_SEES_WHAT.map((row) => (
              <div key={row.who} className="py-4 sm:grid sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="font-semibold text-foreground">{row.who}</dt>
                <dd className={`mt-1 sm:mt-0 ${body}`}>{row.sees}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 3. If you stop checking in */}
        <section aria-labelledby="if-you-stop-checking-in" className="space-y-5">
          <SectionHeading id="if-you-stop-checking-in">What happens if you stop checking in</SectionHeading>
          <p className={body}>
            <strong className="text-foreground">A missed email is not proof that something has happened to you.</strong>{" "}
            Dusk never releases anything just because a timer ran out. These steps come in order, and you can stop the whole
            process at any point before release by checking in.
          </p>
          <ol className="space-y-4">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[13px] font-semibold text-foreground"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-semibold text-foreground">
                    <span className="sr-only">Step {index + 1}: </span>
                    {step.title}
                  </h3>
                  <p className={`mt-1 ${body}`}>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="rounded-xl border border-border bg-card p-5 space-y-2">
            <h3 className="text-[17px] font-semibold text-foreground">If anything is unclear, nothing is released</h3>
            <p className={body}>
              Every one of these stops a release: you check in, a verifier says you are okay, you or a verifier puts it on
              hold, you pause your plan, or too few verifiers agree. If an email service has a problem, the process waits
              instead of moving forward.
            </p>
          </div>
        </section>

        {/* 4. What Dusk can't do */}
        <section aria-labelledby="limits" className="space-y-5">
          <SectionHeading id="limits">What Dusk can&apos;t do</SectionHeading>
          <ul className="list-disc pl-5 space-y-3 text-[16px] leading-relaxed text-foreground-secondary marker:text-foreground-muted">
            <li>
              Dusk can&apos;t tell whether you are alive. It only follows your plan and the answers of the people you chose.
            </li>
            <li>
              Dusk can&apos;t promise that an email arrives. Messages can be delayed or filtered as spam, so tell the people
              you chose to expect mail from Dusk.
            </li>
            <li>Dusk can&apos;t restore a vault after you lose your passphrase and your recovery code.</li>
          </ul>
          <div className="rounded-xl border border-border bg-card p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-3">
              <AlertTriangle strokeWidth={1.5} className="w-5 h-5 text-accent-text shrink-0" aria-hidden="true" />
              <h3 className="text-[17px] font-semibold text-foreground">Dusk is not a will</h3>
            </div>
            <p className="text-sm font-semibold text-foreground">
              {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.notALegalWillHeadline}
            </p>
            <p className="text-sm text-foreground-secondary leading-relaxed">
              {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.zeroKnowledgeCustodyNotice}
            </p>
            <p className="text-sm text-foreground-secondary leading-relaxed">
              {LEGAL_SCOPE_AND_ESTATE_DISCLAIMER.estatePlanningGuidance}
            </p>
          </div>
          <p className={body}>
            You can delete your account yourself in Settings at any time, and your vault and plan are deleted straight away.
            The{" "}
            <Link href="/privacy#how-long-we-keep-it" className="text-accent-text underline underline-offset-2 hover:text-foreground">
              privacy policy
            </Link>{" "}
            lists what we keep and for how long.
          </p>
        </section>

        <TechnicalDetails />
      </main>

      <SiteFooter />
    </div>
  );
}
