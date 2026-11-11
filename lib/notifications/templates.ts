// lib/notifications/templates.ts
// Plain-language email/SMS copy for each notification. Pure functions: no I/O, easy to test.
// Rule: never put vault contents or keys in a message. Links carry single-use tokens only.
import type { NotificationTemplateKey } from "../services/notification-audit-service";
import {
  DECLINE_HINT,
  UNNAMED_OWNER,
  acceptMeaning,
  roleExplanations,
  roleSummary,
} from "../domain/invitation-copy";

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only http(s) links are allowed in a message; anything else renders as no link. */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

interface Copy {
  subject: string;
  intro: string;
  /** Extra paragraphs between the intro and the action button. */
  details?: string[];
  actionLabel: string;
  outro: string;
}

/** Names go into a subject line and a sentence: one line, no control characters, bounded length. */
function cleanName(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return cleaned || null;
}

/**
 * The invitation says plainly which job the person is being asked to accept, who is asking,
 * what accepting means and how to say no. Role and owner come from the invite, never from the reader.
 */
export function contactInvitationCopy(variables: Record<string, unknown>): Copy {
  const owner = cleanName(variables.ownerName, 60) ?? UNNAMED_OWNER;
  const isTrustedVerifier = variables.isTrustedVerifier === true;
  // If the flags are missing or malformed, use the narrowest wording rather than promise a role.
  const isBeneficiary = variables.isBeneficiary === true || !isTrustedVerifier;
  const days = typeof variables.expiresInDays === "number" && variables.expiresInDays > 0
    ? Math.floor(variables.expiresInDays)
    : 14;

  const roles = { isBeneficiary, isTrustedVerifier };
  const role = roleSummary(roles);
  const details = [...roleExplanations(owner, roles), acceptMeaning(owner), DECLINE_HINT];

  return {
    subject: `${owner} has asked you to be ${role} on Dusk`,
    intro: `${owner} has asked you to be ${role} on Dusk. Dusk is a secure place to keep important documents and final wishes for the people someone trusts.`,
    details,
    actionLabel: "Read the invitation",
    outro: `If you were not expecting this, you can ignore it. The link works once and stops working after ${days} days.`,
  };
}

const COPY: Record<NotificationTemplateKey, Copy> = {
  CHECKIN_REMINDER: {
    subject: "Dusk check-in reminder",
    intro: "It is almost time for your Dusk check-in. One click tells us you are okay.",
    actionLabel: "I'm okay, check me in",
    outro: "If you did not expect this, you can ignore it. Nothing is released from one missed reminder.",
  },
  MISSED_CHECKIN_ESCALATION: {
    subject: "URGENT: Dusk missed check-in warning",
    intro:
      "You have missed your Dusk check-in. If you are okay, confirm now. If you do nothing, Dusk will start asking the people you chose to verify.",
    actionLabel: "I'm okay, check me in",
    outro: "Checking in cancels the process and puts everything back to normal.",
  },
  BENEFICIARY_INVITATION: {
    subject: "You've been added to a Dusk release plan",
    intro: "Someone you know chose you to receive their Dusk vault items if something happens to them.",
    actionLabel: "Accept the invitation",
    outro: "You do not need to do anything else for now. Nothing is shared until a careful, staged check is complete.",
  },
  // Placeholder wording: the real text is built per invitation by contactInvitationCopy.
  CONTACT_INVITATION: {
    subject: "You've been asked to help with someone's Dusk plan",
    intro: "Someone you know has asked you to be part of their Dusk plan.",
    actionLabel: "Read the invitation",
    outro: "If you were not expecting this, you can ignore it.",
  },
  TRUSTED_VERIFIER_CHALLENGE: {
    subject: "Action required: Dusk trusted verifier check",
    intro:
      "The person who named you as a trusted verifier has missed their Dusk check-ins. Please tell us what you know.",
    actionLabel: "Open the verifier page",
    outro:
      "Only confirm what you actually know. If you know they are alive, say so and the process stops.",
  },
  RELEASE_PACKAGE_READY: {
    subject: "Dusk release package ready",
    intro: "A Dusk release was authorised and items were set aside for you. The link works once.",
    actionLabel: "Open your package",
    outro: "The items open only on your device with your private key. Dusk cannot read them.",
  },
  SECURITY_ALERT: {
    subject: "Dusk account security alert",
    intro: "We noticed something unusual on your Dusk account.",
    actionLabel: "Review your security settings",
    outro: "If this was you, no action is needed.",
  },
};

export function renderEmail(
  templateKey: NotificationTemplateKey,
  variables: Record<string, unknown>
): RenderedEmail {
  const copy = templateKey === "CONTACT_INVITATION" ? contactInvitationCopy(variables) : COPY[templateKey];
  const url = safeUrl(variables.actionUrl);
  const name =
    typeof variables.recipientName === "string" && variables.recipientName.trim()
      ? variables.recipientName.trim().slice(0, 80)
      : null;
  const greeting = name ? `Hello ${name},` : "Hello,";

  const details = copy.details ?? [];
  const text = [greeting, "", copy.intro, "", ...details.flatMap((d) => [d, ""]), url ? `${copy.actionLabel}: ${url}` : "", "", copy.outro, "", "Dusk"]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(copy.intro)}</p>`,
    ...details.map((d) => `<p>${escapeHtml(d)}</p>`),
    url
      ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(copy.actionLabel)}</a></p><p style="color:#555;font-size:13px">Or paste this link into your browser: ${escapeHtml(url)}</p>`
      : "",
    `<p>${escapeHtml(copy.outro)}</p>`,
    `<p>Dusk</p>`,
  ].join("");

  return { subject: copy.subject, text, html };
}

/** SMS stays short and never contains a single-use link's token. */
export function renderSms(templateKey: NotificationTemplateKey, appUrl: string): string {
  const base = safeUrl(appUrl) ?? "";
  return `[Dusk] ${COPY[templateKey].subject}. Open ${base.replace(/\/$/, "")}/dashboard to respond.`;
}
