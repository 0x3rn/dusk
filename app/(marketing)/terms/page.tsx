import type { Metadata } from "next";
import { SiteDocShell } from "@/components/marketing/site-doc-shell";
import { SITE_DOCS } from "@/lib/site-docs";

export const metadata: Metadata = {
  title: "Terms of service | Dusk",
  description:
    "The terms that govern your use of Dusk from Dusk Technologies.",
};

export default function TermsOfServicePage() {
  return <SiteDocShell doc={SITE_DOCS["terms-of-service"]} />;
}
