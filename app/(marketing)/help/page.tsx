import type { Metadata } from "next";
import { SiteDocShell } from "@/components/marketing/site-doc-shell";
import { SITE_DOCS } from "@/lib/site-docs";

export const metadata: Metadata = {
  title: "Help center | Dusk",
  description:
    "How Dusk check-in schedules, reminders, and trusted verifier roles work.",
};

export default function HelpCenterPage() {
  return <SiteDocShell doc={SITE_DOCS["help-center"]} />;
}
