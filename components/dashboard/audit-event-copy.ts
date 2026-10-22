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
      const reason = asString(meta.reason);
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

    default:
      return {
        title: humanizeEventType(eventType),
        description: "This action was recorded in your activity log.",
      };
  }
}
