import type { Metadata } from "next";
import { SiteDocShell } from "@/components/marketing/site-doc-shell";
import { SITE_DOCS } from "@/lib/site-docs";

export const metadata: Metadata = {
  title: "Privacy policy | Dusk",
  description:
    "How Dusk handles your data, and what we keep and for how long.",
};

export default function PrivacyPolicyPage() {
  return <SiteDocShell doc={SITE_DOCS["privacy-policy"]} />;
}
