// app/invite/[token]/page.tsx
// Public invitation page. Authenticated by the single-use link token alone. This page only LOOKS
// at the invitation: accepting or declining is a button click that POSTs, so an email scanner
// that opens the link cannot use it up.
import type { Metadata } from "next";
import { headers } from "next/headers";
import { InviteCard, type InviteCardState } from "@/components/invite/invite-card";
import { prisma } from "@/lib/db";
import { ContactService } from "@/lib/services/contact-service";
import { PrismaContactStore } from "@/lib/services/prisma-contact-store";
import { RATE_LIMIT_POLICIES, RateLimitExceededError } from "@/lib/security/http-hardening";
import { clientKeyFromHeaders, consumeRateLimit } from "@/lib/security/db-rate-limiter";

export const metadata: Metadata = {
  title: "Your invitation | Dusk",
  // A private link: keep it out of search results and never send it on as a referrer.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const formatExpiry = (date: Date) =>
  new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);

async function lookup(token: string): Promise<InviteCardState> {
  try {
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.INVITE_LINK, clientKeyFromHeaders(await headers()));
  } catch (err) {
    if (err instanceof RateLimitExceededError) return { kind: "limited" };
    throw err;
  }

  const preview = await new ContactService(new PrismaContactStore(prisma)).previewInvitation(token);
  if (preview.state === "EXPIRED") return { kind: "expired" };
  if (preview.state === "INVALID") return { kind: "invalid" };
  return {
    kind: "valid",
    ownerName: preview.ownerName,
    isBeneficiary: preview.isBeneficiary,
    isTrustedVerifier: preview.isTrustedVerifier,
    expiresOn: formatExpiry(preview.expiresAt),
  };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteCard token={token} state={await lookup(token)} />;
}
