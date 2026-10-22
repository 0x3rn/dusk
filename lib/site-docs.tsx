import React from "react";

export interface SiteDoc {
  category: string;
  title: string;
  body: React.ReactNode;
}

export const SITE_DOCS: Record<string, SiteDoc> = {
  "help-center": {
    category: "Support",
    title: "Dusk help center",
    body: (
      <div className="space-y-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          How check-in schedules work
        </h2>
        <p>
          You configure check-in intervals (e.g., every 30, 90, or 180 days). Dusk sends reminders by email or SMS. Confirming your check-in resets your timer.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          What happens if a check-in is missed?
        </h2>
        <p>
          A missed deadline enters a configurable grace period with reminders. Release cannot occur without completing the full staged verification workflow.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Separation of trusted verifiers and beneficiaries
        </h2>
        <p>
          Trusted verifiers (who attest to your status) and beneficiaries (who receive access packages) are distinct roles. You may configure them independently.
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
          Dusk is designed with privacy as a core engineering invariant, not merely a legal policy.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Data minimization
        </h2>
        <p>
          We do not collect tracker cookies, commercial marketing analytics, or profile data. We retain only the minimum metadata required to operate your account and execute your check-in notifications.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Encrypted vault storage
        </h2>
        <p>
          Vault contents are stored solely in encrypted form. Dusk personnel, service providers, and automated pipelines have no capability to read your stored content.
        </p>
        <p>
          Dusk Technologies operates Dusk and is responsible for the practices described in this policy.
        </p>
      </div>
    ),
  },
  "terms-of-service": {
    category: "Legal",
    title: "Terms of service",
    body: (
      <div className="space-y-4">
        <h2 className="text-[15px] font-semibold text-foreground">
          Scope of service
        </h2>
        <p>
          Dusk provides digital instruction organization and encrypted delivery infrastructure. Dusk does not provide legal, probate, estate-planning, or financial advisory services.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Legal estates and asset transfers
        </h2>
        <p>
          Dusk organizes your instructions and credentials; it does not legally transfer legal title to assets, real estate, bank accounts, or financial holdings. Legal disposition remains governed by applicable jurisdiction laws and valid wills.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          User key responsibility
        </h2>
        <p>
          Users are solely responsible for securing their credentials and recovery kits. Dusk cannot bypass the encryption in the event of lost credentials.
        </p>
        <p>
          These terms are provided by Dusk Technologies, the operator of Dusk.
        </p>
      </div>
    ),
  },
  "security-disclosures": {
    category: "Security",
    title: "Security disclosures and vulnerability reporting",
    body: (
      <div className="space-y-4">
        <p>
          Dusk welcomes responsible disclosures from security researchers and cryptographers.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Reporting process
        </h2>
        <p>
          Send encrypted reports to security@dusk.infrastructure with detailed steps to reproduce, cryptographic proof of concept, and environment specifications.
        </p>
        <h2 className="text-[15px] font-semibold text-foreground">
          Response commitment
        </h2>
        <p>
          We acknowledge valid submissions within 24 business hours and prioritize remediation for any findings affecting our trust boundaries or encryption guarantees.
        </p>
      </div>
    ),
  },
};
