import type { Metadata } from "next";
import { SiteDocShell } from "@/components/marketing/site-doc-shell";
import { SITE_DOCS } from "@/lib/site-docs";

export const metadata: Metadata = {
  title: "Security disclosures | Dusk",
  description:
    "How to report a security vulnerability in Dusk responsibly.",
};

export default function SecurityDisclosuresPage() {
  return <SiteDocShell doc={SITE_DOCS["security-disclosures"]} />;
}
