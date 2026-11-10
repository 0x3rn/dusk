import React from "react";

export interface SiteDoc {
  category: string;
  title: string;
  body: React.ReactNode;
}

// Same heading style for every document page, so the structure is easy to scan.
function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold text-foreground pt-2">{children}</h2>;
}

export const SITE_DOCS: Record<string, SiteDoc> = {
  "help-center": {
    category: "Support",
    title: "Dusk help center",
    body: (
      <div className="space-y-4">
        <H>How do check-ins work?</H>
        <p>
          You choose how often to check in, for example every 30, 90 or 180 days. Dusk reminds you by email or SMS
          before each check-in is due. When you check in, the timer starts again.
        </p>
        <H>What happens if I miss a check-in?</H>
        <p>
          Nothing is sent right away. You get a grace period and more reminders first. If you still don&apos;t check in,
          Dusk asks your trusted verifiers to confirm. Your items are only released after those steps are finished.
          You can stop the process at any time before release by checking in.
        </p>
        <H>What is the difference between a trusted verifier and a beneficiary?</H>
        <p>
          A trusted verifier confirms whether you are okay, or whether a release is real. A beneficiary receives the
          items you choose for them. They are separate roles. One person can have both, but they don&apos;t have to.
        </p>
        <H>What is my master passphrase?</H>
        <p>
          It is the passphrase that locks your vault. It is different from your account password. It never leaves your
          device, so Dusk can&apos;t see it or reset it.
        </p>
        <H>What if I forget my passphrase?</H>
        <p>
          Use the recovery code from your recovery kit. Open the Digital vault page and choose to use your recovery
          code. If you have lost both your passphrase and your recovery code, nobody, including Dusk, can open your
          vault.
        </p>
        <H>How do my beneficiaries get what I gave them?</H>
        <p>
          When you add a beneficiary, Dusk gives you a private unlock link to send to them yourself. After a release is
          confirmed, they use that link to open only the items you assigned to them.
        </p>
      </div>
    ),
  },
  "privacy-policy": {
    category: "Legal",
    title: "Privacy policy",
    body: (
      <div className="space-y-4">
        <p>
          Dusk is built so that we can&apos;t read what you store. This page explains what we do keep.
        </p>
        <H>What we collect</H>
        <p>
          Only what we need to run your account and send your check-in reminders. We don&apos;t use tracking cookies,
          marketing analytics or advertising profiles.
        </p>
        <H>Your vault</H>
        <p>
          Your vault is stored only in encrypted form. Dusk staff, service providers and our automated systems can&apos;t
          read it.
        </p>
        <H>Who is responsible</H>
        <p>
          Dusk Technologies operates Dusk and is responsible for the practices described on this page.
        </p>
      </div>
    ),
  },
  "terms-of-service": {
    category: "Legal",
    title: "Terms of service",
    body: (
      <div className="space-y-4">
        <H>What Dusk does</H>
        <p>
          Dusk keeps your instructions and login details in an encrypted vault and delivers them to the people you
          choose. Dusk does not give legal, probate, estate-planning or financial advice.
        </p>
        <H>What Dusk does not do</H>
        <p>
          Dusk does not transfer ownership of property, real estate, bank accounts or other assets. That is decided by
          the laws where you live and by a valid will.
        </p>
        <H>Your responsibility for your keys</H>
        <p>
          You are responsible for keeping your passphrase and recovery kit safe. If you lose them, Dusk can&apos;t open
          your vault for you.
        </p>
        <p>
          These terms are provided by Dusk Technologies, the operator of Dusk.
        </p>
      </div>
    ),
  },
  "security-disclosures": {
    category: "Security",
    title: "Report a security problem",
    body: (
      <div className="space-y-4">
        <p>
          If you have found a security problem in Dusk, we want to hear about it.
        </p>
        <H>How to report it</H>
        <p>
          Send encrypted reports to security@dusk.infrastructure. Include the steps to reproduce the problem, a proof
          of concept, and the environment you tested in.
        </p>
        <H>What to expect from us</H>
        <p>
          We acknowledge valid reports within 24 business hours. Problems that affect your encryption or who can
          access what are fixed first.
        </p>
      </div>
    ),
  },
};
