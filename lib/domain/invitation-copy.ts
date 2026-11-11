// lib/domain/invitation-copy.ts
// The plain-language wording for an invitation, shared by the email and the public invitation
// page so the two can never say different things. Pure: no server or browser imports.

export interface InvitationRoles {
  isBeneficiary: boolean;
  isTrustedVerifier: boolean;
}

/** Used when the owner has no name on their account. Never their email address. */
export const UNNAMED_OWNER = "Someone you know";

/** "a beneficiary", "a trusted verifier" or both. */
export function roleSummary(roles: InvitationRoles): string {
  if (roles.isBeneficiary && roles.isTrustedVerifier) return "a beneficiary and a trusted verifier";
  if (roles.isTrustedVerifier) return "a trusted verifier";
  return "a beneficiary";
}

/** One short paragraph per role: what the person would actually be doing. */
export function roleExplanations(owner: string, roles: InvitationRoles): string[] {
  const out: string[] = [];
  if (roles.isBeneficiary) {
    out.push(
      `As a beneficiary, you would receive the items ${owner} chooses for you if something happens to them. Dusk shares those items only after several careful checks are complete.`
    );
  }
  if (roles.isTrustedVerifier) {
    out.push(
      `As a trusted verifier, you would help confirm that ${owner} is okay. If they stop checking in, Dusk may email you to ask what you know. You only say what you actually know, and you cannot see anything they have stored.`
    );
  }
  return out;
}

export function acceptMeaning(owner: string): string {
  return `Choosing Accept does not give you access to anything today. It only tells ${owner} that you are willing. You do not need a Dusk account.`;
}

export const DECLINE_HINT =
  "If you would rather not, ignore this email. You can also choose Decline on the invitation page.";
