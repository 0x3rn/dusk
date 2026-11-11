import { formatCount, formatDateTime } from "@/lib/display-format";

export interface AuditContactLike {
  id: string;
  fullName: string;
  email?: string;
}

export interface AuditEventDisplay {
  title: string;
  description: string;
}

function parseMeta(redactedMeta: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(redactedMeta);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function humanizeEventType(eventType: string): string {
  const words = eventType.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return "Activity recorded";
  const first = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return [first, ...words.slice(1)].join(" ");
}

function resolveContactName(
  meta: Record<string, unknown>,
  contacts: AuditContactLike[],
  fallback = "A trusted verifier"
): string {
  const contactId = asString(meta.contactId);
  if (contactId) {
    const contact = contacts.find((candidate) => candidate.id === contactId);
    if (contact?.fullName) return contact.fullName;
  }

  return (
    asString(meta.contactName) ||
    asString(meta.fullName) ||
    asString(meta.email) ||
    fallback
  );
}

function resolveRole(meta: Record<string, unknown>): string {
  const isBeneficiary = Boolean(meta.isBeneficiary);
  const isTrustedVerifier = Boolean(meta.isTrustedVerifier);

  if (isBeneficiary && isTrustedVerifier) return "beneficiary and trusted verifier";
  if (isBeneficiary) return "beneficiary";
  if (isTrustedVerifier) return "trusted verifier";
  return "contact";
}

function withPeriod(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

export function getAuditEventDisplay(
  eventType: string,
  redactedMeta: string,
  contacts: AuditContactLike[] = []
): AuditEventDisplay {
  const meta = parseMeta(redactedMeta);

  switch (eventType) {
    case "PROOF_OF_LIFE_CHECKIN_CONFIRMED": {
      const nextDue = asString(meta.nextDueAtIso);
      return {
        title: "You checked in",
        description: nextDue
          ? `Your next check-in is due ${formatDateTime(nextDue)}.`
          : "Your check-in was recorded.",
      };
    }

    case "WORKFLOW_STATE_REMINDER_DUE": {
      const reminderNumber =
        asNumber(meta.reminderNumber) ?? asNumber(meta.remindersSentCount);
      return {
        title: "Check-in reminder sent",
        description:
          reminderNumber !== undefined
            ? `You're due to check in. Reminder ${reminderNumber} sent.`
            : "You're due to check in.",
      };
    }

    case "WORKFLOW_STATE_GRACE_PERIOD":
      return {
        title: "Grace period started",
        description:
          "You missed a check-in. Dusk is waiting before contacting anyone.",
      };

    case "WORKFLOW_STATE_ESCALATION_PENDING":
      return {
        title: "Contacting your trusted verifiers",
        description: "The grace period ended without a check-in.",
      };

    case "WORKFLOW_STATE_VERIFICATION_REQUIRED":
      return {
        title: "Verification needed",
        description:
          "A trusted verifier must confirm before anything is released.",
      };

    case "TRUSTED_CONTACT_SIGNALED_ALIVE": {
      const name = resolveContactName(meta, contacts);
      return {
        title: `${name} confirmed you're okay`,
        description: "The release process was stopped.",
      };
    }

    case "ESTATE_RELEASE_AUTHORIZED": {
      const verifier = asString(meta.verifierName);
      const beneficiary = asString(meta.beneficiaryName);
      if (verifier && beneficiary) {
        return {
          title: "Release approved",
          description: `${verifier} approved release to ${beneficiary}.`,
        };
      }

      const approverCount = asNumber(meta.approverCount);
      return {
        title: "Release approved",
        description:
          approverCount !== undefined
            ? `Release approved after ${formatCount(
                approverCount,
                "verifier approval"
              )}.`
            : "All required approvals were recorded.",
      };
    }

    case "BENEFICIARY_PACKAGE_DELIVERED": {
      const beneficiary = resolveContactName(meta, contacts, "a beneficiary");
      const itemCount = asNumber(meta.deliveredItemCount) ?? 0;
      return {
        title: "Package delivered",
        description: `${formatCount(itemCount, "item")} sent to ${beneficiary}.`,
      };
    }

    case "BENEFICIARY_ITEM_ASSIGNED": {
      const beneficiary = resolveContactName(meta, contacts, "a beneficiary");
      return {
        title: "Item assigned",
        description: `An item was assigned to ${beneficiary}.`,
      };
    }

    case "CONTACT_VERIFIED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Contact verified",
        description: `${name} confirmed their email as a ${resolveRole(meta)}.`,
      };
    }

    case "CONTACT_SAVED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Contact added",
        description: `${name} was added as a ${resolveRole(meta)}.`,
      };
    }

    case "CONTACT_REVOKED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Contact removed",
        description: `${name} no longer has access.`,
      };
    }

    case "CHECKIN_SCHEDULE_PAUSED": {
      const pauseDays = asNumber(meta.pauseDays) ?? 0;
      // The dashboard's own default reason adds nothing for the reader, so leave it out.
      const rawReason = asString(meta.reason);
      const reason = rawReason === "Paused from dashboard console" ? undefined : rawReason;
      return {
        title: "Check-ins paused",
        description: withPeriod(
          `Paused for ${formatCount(pauseDays, "day")}${
            reason ? `. Reason: ${reason}` : ""
          }`
        ),
      };
    }

    case "CHECKIN_SCHEDULE_CONFIGURED":
      return {
        title: "Check-in schedule updated",
        description: "Your check-in interval and grace period were saved.",
      };

    case "RECOVERY_KIT_CREATED":
      return {
        title: "Recovery kit created",
        description: "A recovery kit was generated for this vault.",
      };

    case "VAULT_KDF_UPGRADED":
      return {
        title: "Vault protection strengthened",
        description:
          "Your vault now uses stronger protection for your passphrase. Your items and recovery kit were not changed.",
      };

    case "VAULT_ITEM_DELETED":
      return {
        title: "Vault item deleted",
        description: "An item was removed from your vault.",
      };

    case "BENEFICIARY_ITEM_UNASSIGNED": {
      const beneficiary = resolveContactName(meta, contacts, "a beneficiary");
      return {
        title: "Item unassigned",
        description: `An item was unassigned from ${beneficiary}.`,
      };
    }

    case "ACCOUNT_CREATED":
      return {
        title: "Account created",
        description: "Your Dusk account was set up.",
      };

    case "AUTH_IDENTITY_LINKED":
      return {
        title: "Sign-in method linked",
        description: "A sign-in method was linked to your account.",
      };

    case "AUTH_SIGNED_OUT":
      return {
        title: "You signed out",
        description: "You ended your session on a device.",
      };

    case "LIFETIME_ACCESS_GRANTED":
      return {
        title: "Payment received",
        description: "Your one-time payment was received and your lifetime access is active.",
      };

    case "LIFETIME_ACCESS_REVOKED":
      return {
        title: "Payment refunded",
        description:
          meta.accessKept === true
            ? "A payment was refunded. Your lifetime access stays because you have another paid order."
            : "Your payment was refunded, so lifetime access has ended.",
      };

    case "LIFETIME_ACCESS_PARTIAL_REFUND":
      return {
        title: "Partial refund",
        description: "Part of your payment was refunded. Your lifetime access is unchanged.",
      };

    case "CONTACT_INVITED":
    case "CONTACT_REINVITED": {
      const name = resolveContactName(meta, contacts, "A contact");
      const sentAgain = eventType === "CONTACT_REINVITED";
      return {
        title: sentAgain ? "Invitation sent again" : "Invitation sent",
        description: sentAgain
          ? `${name} was sent a new invitation as a ${resolveRole(meta)}. The earlier link no longer works.`
          : `${name} was invited as a ${resolveRole(meta)}. They can take part only after they accept.`,
      };
    }

    case "CONTACT_INVITE_ACCEPTED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Invitation accepted",
        description: `${name} accepted as a ${resolveRole(meta)}. They can now take part in a release.`,
      };
    }

    case "CONTACT_INVITE_DECLINED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Invitation declined",
        description: `${name} chose not to be a ${resolveRole(meta)}. They won't be asked again unless you add them again.`,
      };
    }

    case "CONTACT_INVITE_EXPIRED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Invitation expired",
        description: `${name} did not accept in time. Send a new invitation if you still want them in your plan.`,
      };
    }

    case "CONTACT_INVITE_CANCELED": {
      const name = resolveContactName(meta, contacts, "A contact");
      return {
        title: "Invitation cancelled",
        description: `You cancelled the invitation to ${name}. The link no longer works.`,
      };
    }

    case "SECURITY_NOTIFICATION_DELIVERY_FAILED":
      return {
        title: "An email could not be sent",
        description:
          asString(meta.templateKey) === "CONTACT_INVITATION"
            ? "We couldn't deliver an invitation. Use Resend invitation under People & access to try again."
            : "We couldn't deliver a message. Check your plan on the dashboard.",
      };

    case "VERIFIER_CHALLENGE_ISSUED": {
      const name = resolveContactName(meta, contacts, "A trusted verifier");
      return {
        title: "Verifier asked to confirm",
        description: `${name} was sent a link to confirm whether you are okay.`,
      };
    }

    case "VERIFIER_ATTESTED_ALIVE": {
      const name = resolveContactName(meta, contacts);
      return {
        title: `${name} confirmed you're okay`,
        description: "The release process was stopped.",
      };
    }

    case "FALSE_TRIGGER_CANCELED":
    case "FALSE_TRIGGER_CANCELED_BY_OWNER":
      return {
        title: "Release process stopped",
        description: "The process was canceled before anything was released.",
      };

    case "BENEFICIARY_ACCESS_GRANT_ISSUED": {
      const beneficiary = resolveContactName(meta, contacts, "A beneficiary");
      return {
        title: "Access link sent",
        description: `${beneficiary} was sent a one-time link to open their items.`,
      };
    }

    case "PACKAGE_RECEIPT_ACKNOWLEDGED": {
      const beneficiary = resolveContactName(meta, contacts, "A beneficiary");
      return {
        title: "Items received",
        description: `${beneficiary} confirmed they received their items.`,
      };
    }

    case "RECOVERY_KIT_REVOKED":
      return {
        title: "Recovery kit replaced",
        description: "An earlier recovery kit can no longer be used.",
      };

    case "RECOVERY_KIT_ROTATED":
      return {
        title: "Recovery kit replaced",
        description: "A new recovery kit was made and the old one can no longer be used.",
      };

    default:
      return {
        title: humanizeEventType(eventType),
        description: "Recorded on your account.",
      };
  }
}
