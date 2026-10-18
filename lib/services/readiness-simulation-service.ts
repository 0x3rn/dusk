// lib/services/readiness-simulation-service.ts
import {
  AuthenticationError,
  assertResourceOwnership,
} from "../auth/security";
import {
  canParticipateInReleaseVerification,
  canReceiveReleasePackage,
  type ContactRecord,
} from "./contact-service";
import type { VaultRecord } from "./foundation-service";
import type { RecoveryArtifactRecord } from "./recovery-service";
import type { ReleaseAssignmentRecord } from "./selective-release-service";
import type { DetailedScheduleRecord } from "./checkin-schedule-service";
import type {
  EncryptedFileRecord,
  WorkspaceEncryptedItemRecord,
} from "./vault-workspace-service";

/**
 * THE-107: Non-Destructive Release Simulation & Recovery Readiness Checks
 *
 * Invariants:
 * 1. Simulation NEVER marks a schedule as RELEASED, NEVER creates access grant tokens,
 *    and NEVER dispatches real beneficiary release notifications.
 * 2. Readiness checks operate strictly on cryptographic/operational metadata and
 *    NEVER require decrypting or exposing vault plaintext.
 */

export type ReadinessCheckStatus = "PASS" | "WARN" | "FAIL";

export interface ReadinessChecklistItem {
  checkId:
    | "VAULT_INITIALIZED"
    | "RECOVERY_KIT_READY"
    | "CHECKIN_SCHEDULE_HEALTHY"
    | "VERIFIER_QUORUM_POSSIBLE"
    | "BENEFICIARIES_CRYPTO_READY"
    | "VAULT_ITEMS_ASSIGNED"
    | "KEY_VERSION_CONSISTENCY"
    | "ENCRYPTED_FILES_INTEGRITY_META";
  title: string;
  status: ReadinessCheckStatus;
  summary: string;
  remediation?: string;
  affectedResourceIds: string[];
}

export interface BeneficiaryDryRunPreview {
  contactId: string;
  fullName: string;
  email: string;
  status: ContactRecord["status"];
  isCryptoReady: boolean;
  assignedItemIds: string[];
  staleKeyVersionItemIds: string[];
}

export interface ReleaseSimulationAndReadinessReport {
  isSimulationOnly: true;
  estateMarkedReleased: false;
  overallReadyForEmergency: boolean;
  readinessScorePercent: number;
   simulatedAtIso: string;
  checklist: ReadinessChecklistItem[];
  verifierQuorumSummary: {
    requiredApprovals: number;
    verifiedTrustedVerifiersCount: number;
    pendingInviteVerifiersCount: number;
    quorumAchievable: boolean;
  };
  beneficiaryPackagesPreview: BeneficiaryDryRunPreview[];
  unassignedItemIds: string[];
}

export interface ReadinessSimulationPersistencePort {
  findVaultByUserId(userId: string): Promise<VaultRecord | null>;
  findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null>;
  listItemsByUserId(userId: string): Promise<WorkspaceEncryptedItemRecord[]>;
  listFilesByUserId(userId: string): Promise<EncryptedFileRecord[]>;
  listContactsByUserId(userId: string): Promise<ContactRecord[]>;
  listAssignmentsByUserId(userId: string): Promise<ReleaseAssignmentRecord[]>;
  listActiveRecoveryArtifactsByUserId(
    userId: string
  ): Promise<RecoveryArtifactRecord[]>;
  appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void>;
}

export class ReadinessSimulationService {
  constructor(private readonly store: ReadinessSimulationPersistencePort) {}

  /**
   * Executes a non-destructive dry-run release simulation and readiness audit
   * for the authenticated user's digital estate.
   */
  async runReleaseSimulationAndReadinessCheck(
    authenticatedUserId: string | null | undefined,
    now = new Date()
  ): Promise<ReleaseSimulationAndReadinessReport> {
    if (!authenticatedUserId) {
      throw new AuthenticationError();
    }

    const [
      vault,
      schedule,
      items,
      files,
      contacts,
      assignments,
      recoveryArtifacts,
    ] = await Promise.all([
      this.store.findVaultByUserId(authenticatedUserId),
      this.store.findScheduleByUserId(authenticatedUserId),
      this.store.listItemsByUserId(authenticatedUserId),
      this.store.listFilesByUserId(authenticatedUserId),
      this.store.listContactsByUserId(authenticatedUserId),
      this.store.listAssignmentsByUserId(authenticatedUserId),
      this.store.listActiveRecoveryArtifactsByUserId(authenticatedUserId),
    ]);

    if (vault) {
      assertResourceOwnership(vault, authenticatedUserId, "Vault");
    }
    if (schedule) {
      assertResourceOwnership(schedule, authenticatedUserId, "CheckInSchedule");
    }

    const checklist: ReadinessChecklistItem[] = [];
    const activeContacts = contacts.filter((c) => c.status !== "REVOKED");
    const contactMap = new Map(contacts.map((c) => [c.id, c]));

    // 1. Check Vault Initialized
    if (!vault) {
      checklist.push({
        checkId: "VAULT_INITIALIZED",
        title: "Zero-Knowledge Vault Initialized",
        status: "FAIL",
        summary: "Your encrypted vault has not been initialized yet.",
        remediation:
          "Set a Master Passphrase on your dashboard to generate your 256-bit Vault Master Key.",
        affectedResourceIds: [],
      });
    } else {
      checklist.push({
        checkId: "VAULT_INITIALIZED",
        title: "Zero-Knowledge Vault Initialized",
        status: "PASS",
        summary: `Vault initialized at keyVersion v${vault.currentKeyVersion} (${vault.kdfAlgorithm}).`,
        affectedResourceIds: [vault.id],
      });
    }

    // 2. Check Recovery Kit Status & Key Version Consistency
    const matchingRecoveryKit = vault
      ? recoveryArtifacts.find(
          (a) =>
            a.isActive &&
            a.revokedAt === null &&
            a.keyVersion === vault.currentKeyVersion
        )
      : null;

    if (!vault || !matchingRecoveryKit) {
      checklist.push({
        checkId: "RECOVERY_KIT_READY",
        title: "Offline Recovery Kit Active & Current",
        status: "FAIL",
        summary:
          recoveryArtifacts.length === 0
            ? "No active Recovery Kit exists for your vault."
            : "Your active Recovery Kit keyVersion does not match your current Vault Master Key version.",
        remediation:
          "Generate and download a fresh offline Recovery Kit matching your current vault key version.",
        affectedResourceIds: recoveryArtifacts.map((a) => a.id),
      });
    } else {
      checklist.push({
        checkId: "RECOVERY_KIT_READY",
        title: "Offline Recovery Kit Active & Current",
        status: "PASS",
        summary: `Active Recovery Kit verified (fingerprint: ${matchingRecoveryKit.fingerprintHex}, kv:${matchingRecoveryKit.keyVersion}).`,
        affectedResourceIds: [matchingRecoveryKit.id],
      });
    }

    // 3. Check-In Schedule Health
    if (!schedule) {
      checklist.push({
        checkId: "CHECKIN_SCHEDULE_HEALTHY",
        title: "Proof-of-Life Schedule Active",
        status: "FAIL",
        summary: "No Proof-of-Life check-in schedule is configured.",
        remediation: "Configure your check-in interval and grace period.",
        affectedResourceIds: [],
      });
    } else if (schedule.state !== "HEALTHY" && schedule.state !== "PAUSED") {
      checklist.push({
        checkId: "CHECKIN_SCHEDULE_HEALTHY",
        title: "Proof-of-Life Schedule Active",
        status: "WARN",
        summary: `Schedule is currently in ${schedule.state} state.`,
        remediation:
          "Confirm proof-of-life check-in or cancel false trigger if no emergency is occurring.",
        affectedResourceIds: [schedule.id],
      });
    } else {
      checklist.push({
        checkId: "CHECKIN_SCHEDULE_HEALTHY",
        title: "Proof-of-Life Schedule Active",
        status: "PASS",
        summary: `Schedule is ${schedule.state} (${schedule.intervalDays}d interval, ${schedule.gracePeriodDays}d grace).`,
        affectedResourceIds: [schedule.id],
      });
    }

    // 4. Trusted Verifier Quorum Check
    const requiredApprovals = schedule?.requiredVerifierApprovals ?? 1;
    const verifiedVerifiers = activeContacts.filter((c) =>
      canParticipateInReleaseVerification(c)
    );
    const pendingVerifiers = activeContacts.filter(
      (c) => c.isTrustedVerifier && c.status === "PENDING_INVITE"
    );
    const quorumAchievable = verifiedVerifiers.length >= requiredApprovals;

    if (!quorumAchievable) {
      checklist.push({
        checkId: "VERIFIER_QUORUM_POSSIBLE",
        title: "Trusted Verifier Quorum Achievable",
        status: "FAIL",
        summary: `Release policy requires ${requiredApprovals} Trusted Verifier approval(s), but only ${verifiedVerifiers.length} verified Trusted Verifier(s) exist.`,
        remediation:
          pendingVerifiers.length > 0
            ? "Have your pending Trusted Verifiers accept their invitations, or add more Trusted Verifiers."
            : "Invite and verify at least one Trusted Verifier so release authorization will not deadlock.",
        affectedResourceIds: pendingVerifiers.map((c) => c.id),
      });
    } else {
      checklist.push({
        checkId: "VERIFIER_QUORUM_POSSIBLE",
        title: "Trusted Verifier Quorum Achievable",
        status: "PASS",
        summary: `${verifiedVerifiers.length} verified Trusted Verifier(s) ready to satisfy the ${requiredApprovals}-approval threshold.`,
        affectedResourceIds: verifiedVerifiers.map((c) => c.id),
      });
    }

    // 5. Beneficiary Cryptographic & Contact Readiness
    const beneficiaryContacts = activeContacts.filter((c) => c.isBeneficiary);
    const invalidBeneficiaries = beneficiaryContacts.filter(
      (c) => !canReceiveReleasePackage(c)
    );

    if (beneficiaryContacts.length === 0) {
      checklist.push({
        checkId: "BENEFICIARIES_CRYPTO_READY",
        title: "Beneficiaries Verified & Cryptographically Enrolled",
        status: "FAIL",
        summary: "No Beneficiaries have been designated to receive your estate.",
        remediation: "Add at least one Beneficiary contact.",
        affectedResourceIds: [],
      });
    } else if (invalidBeneficiaries.length > 0) {
      checklist.push({
        checkId: "BENEFICIARIES_CRYPTO_READY",
        title: "Beneficiaries Verified & Cryptographically Enrolled",
        status: "WARN",
        summary: `${invalidBeneficiaries.length} Beneficiary contact(s) have pending invitations, suspended status, or missing public keys.`,
        remediation:
          "Re-invite stale beneficiaries or ensure they complete public-key onboarding.",
        affectedResourceIds: invalidBeneficiaries.map((c) => c.id),
      });
    } else {
      checklist.push({
        checkId: "BENEFICIARIES_CRYPTO_READY",
        title: "Beneficiaries Verified & Cryptographically Enrolled",
        status: "PASS",
        summary: `All ${beneficiaryContacts.length} Beneficiary contact(s) are verified with ECDH P-256 public keys.`,
        affectedResourceIds: beneficiaryContacts.map((c) => c.id),
      });
    }

    // 6. Vault Items Assigned & Orphaned Assignment Detection
    const validItemIdsWithActiveBeneficiary = new Set<string>();
    const orphanedOrRevokedAssignmentIds: string[] = [];
    const staleKeyVersionItemIds: string[] = [];
    const itemMap = new Map(items.map((i) => [i.id, i]));

    const beneficiaryPackagesMap = new Map<string, BeneficiaryDryRunPreview>();
    for (const ben of beneficiaryContacts) {
      beneficiaryPackagesMap.set(ben.id, {
        contactId: ben.id,
        fullName: ben.fullName,
        email: ben.email,
        status: ben.status,
        isCryptoReady: canReceiveReleasePackage(ben),
        assignedItemIds: [],
        staleKeyVersionItemIds: [],
      });
    }

    for (const asg of assignments) {
      const targetContact = contactMap.get(asg.contactId);
      const targetItem = itemMap.get(asg.itemId);

      if (
        !targetContact ||
        targetContact.status === "REVOKED" ||
        targetContact.status === "SUSPENDED" ||
        !targetContact.isBeneficiary ||
        !targetItem
      ) {
        orphanedOrRevokedAssignmentIds.push(asg.id);
        continue;
      }

      const preview = beneficiaryPackagesMap.get(targetContact.id);
      if (targetItem.keyVersion !== asg.keyVersion) {
        staleKeyVersionItemIds.push(targetItem.id);
        preview?.staleKeyVersionItemIds.push(targetItem.id);
        continue;
      }

      if (canReceiveReleasePackage(targetContact)) {
        validItemIdsWithActiveBeneficiary.add(targetItem.id);
      }
      preview?.assignedItemIds.push(targetItem.id);
    }

    const unassignedItemIds = items
      .filter((i) => !validItemIdsWithActiveBeneficiary.has(i.id))
      .map((i) => i.id);

    if (items.length === 0) {
      checklist.push({
        checkId: "VAULT_ITEMS_ASSIGNED",
        title: "Vault Items Assigned to Beneficiaries",
        status: "WARN",
        summary: "Your vault currently has 0 stored items.",
        remediation: "Add encrypted secrets to your vault and assign them to beneficiaries.",
        affectedResourceIds: [],
      });
    } else if (
      unassignedItemIds.length > 0 ||
      orphanedOrRevokedAssignmentIds.length > 0
    ) {
      checklist.push({
        checkId: "VAULT_ITEMS_ASSIGNED",
        title: "Vault Items Assigned to Beneficiaries",
        status: "WARN",
        summary: `${unassignedItemIds.length} vault item(s) have no active verified Beneficiary assignment, and ${orphanedOrRevokedAssignmentIds.length} assignment(s) reference removed/suspended contacts.`,
        remediation:
          "Assign unassigned vault items to an active Beneficiary so they are included upon release.",
        affectedResourceIds: [
          ...unassignedItemIds,
          ...orphanedOrRevokedAssignmentIds,
        ],
      });
    } else {
      checklist.push({
        checkId: "VAULT_ITEMS_ASSIGNED",
        title: "Vault Items Assigned to Beneficiaries",
        status: "PASS",
        summary: `All ${items.length} vault item(s) are assigned to active, verified Beneficiaries.`,
        affectedResourceIds: items.map((i) => i.id),
      });
    }

    // 7. Key-Version Consistency Across Vault, Items & Assignments
    const outdatedVaultItems = vault
      ? items.filter((i) => i.keyVersion !== vault.currentKeyVersion)
      : [];
    const allStaleKeyIds = [
      ...new Set([...outdatedVaultItems.map((i) => i.id), ...staleKeyVersionItemIds]),
    ];

    if (allStaleKeyIds.length > 0) {
      checklist.push({
        checkId: "KEY_VERSION_CONSISTENCY",
        title: "Cryptographic Key-Version Consistency",
        status: "FAIL",
        summary: `${allStaleKeyIds.length} item(s) or beneficiary assignment(s) have a stale keyVersion that does not match the current vault/item keyVersion.`,
        remediation:
          "Unlock your vault and re-wrap stale items and beneficiary assignments to the current keyVersion.",
        affectedResourceIds: allStaleKeyIds,
      });
    } else {
      checklist.push({
        checkId: "KEY_VERSION_CONSISTENCY",
        title: "Cryptographic Key-Version Consistency",
        status: "PASS",
        summary:
          "All vault items, recovery artifacts, and beneficiary grants have consistent keyVersions.",
        affectedResourceIds: [],
      });
    }

    // 8. Encrypted File Reference & Integrity Metadata Check
    const brokenFiles = files.filter(
      (f) =>
        !f.storageBlobKey ||
        !/^[a-f0-9]{64}$/.test(f.ciphertextSha256Hex) ||
        (f.itemId !== null && !itemMap.has(f.itemId)) ||
        (vault && f.keyVersion !== vault.currentKeyVersion)
    );

    if (brokenFiles.length > 0) {
      checklist.push({
        checkId: "ENCRYPTED_FILES_INTEGRITY_META",
        title: "Encrypted File Attachments & Integrity References",
        status: "FAIL",
        summary: `${brokenFiles.length} encrypted file attachment(s) have broken item references, missing storage keys, or outdated keyVersions.`,
        remediation: "Re-upload or remove broken encrypted file attachments.",
        affectedResourceIds: brokenFiles.map((f) => f.id),
      });
    } else {
      checklist.push({
        checkId: "ENCRYPTED_FILES_INTEGRITY_META",
        title: "Encrypted File Attachments & Integrity References",
        status: "PASS",
        summary: `${files.length} encrypted file attachment(s) verified with valid SHA-256 integrity metadata.`,
        affectedResourceIds: files.map((f) => f.id),
      });
    }

    const failCount = checklist.filter((c) => c.status === "FAIL").length;
    const passCount = checklist.filter((c) => c.status === "PASS").length;
    const readinessScorePercent = Math.round(
      (passCount / checklist.length) * 100
    );

    await this.store.appendAuditEvent({
      userId: authenticatedUserId,
      eventType: "RELEASE_SIMULATION_DRY_RUN_EXECUTED",
      severity: "INFO",
      redactedMeta: JSON.stringify({
        overallReadyForEmergency: failCount === 0,
        readinessScorePercent,
        failCount,
      }),
    });

    return {
      isSimulationOnly: true,
      estateMarkedReleased: false,
      overallReadyForEmergency: failCount === 0,
      readinessScorePercent,
      simulatedAtIso: now.toISOString(),
      checklist,
      verifierQuorumSummary: {
        requiredApprovals,
        verifiedTrustedVerifiersCount: verifiedVerifiers.length,
        pendingInviteVerifiersCount: pendingVerifiers.length,
        quorumAchievable,
      },
      beneficiaryPackagesPreview: Array.from(beneficiaryPackagesMap.values()),
      unassignedItemIds,
    };
  }
}