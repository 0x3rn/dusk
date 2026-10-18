// lib/services/readiness-simulation-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  ReadinessSimulationService,
  type ReadinessSimulationPersistencePort,
} from "./readiness-simulation-service";
import type { VaultRecord } from "./foundation-service";
import type { DetailedScheduleRecord } from "./checkin-schedule-service";
import type {
  EncryptedFileRecord,
  WorkspaceEncryptedItemRecord,
} from "./vault-workspace-service";
import type { ContactRecord } from "./contact-service";
import type { ReleaseAssignmentRecord } from "./selective-release-service";
import type { RecoveryArtifactRecord } from "./recovery-service";

class InMemoryReadinessStore implements ReadinessSimulationPersistencePort {
  public vault: VaultRecord | null = null;
  public schedule: DetailedScheduleRecord | null = null;
  public items: WorkspaceEncryptedItemRecord[] = [];
  public files: EncryptedFileRecord[] = [];
  public contacts: ContactRecord[] = [];
  public assignments: ReleaseAssignmentRecord[] = [];
  public recoveryArtifacts: RecoveryArtifactRecord[] = [];
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  async findVaultByUserId() {
    return this.vault;
  }
  async findScheduleByUserId() {
    return this.schedule;
  }
  async listItemsByUserId() {
    return this.items;
  }
  async listFilesByUserId() {
    return this.files;
  }
  async listContactsByUserId() {
    return this.contacts;
  }
  async listAssignmentsByUserId() {
    return this.assignments;
  }
  async listActiveRecoveryArtifactsByUserId() {
    return this.recoveryArtifacts;
  }
  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }) {
    this.audits.push(data);
  }
}

describe("THE-107: Release Simulation & Recovery Readiness Checks", () => {
  let store: InMemoryReadinessStore;
  let service: ReadinessSimulationService;
  const userId = "usr_readiness_owner";
  const now = new Date("2026-10-18T11:00:00Z");

  beforeEach(() => {
    store = new InMemoryReadinessStore();
    service = new ReadinessSimulationService(store);
  });

  it("1. identifies all configuration problems (missing recovery kit, impossible verifier quorum, unassigned items, stale keyVersions, broken files) without marking estate released", async () => {
    store.vault = {
      id: "vlt_1",
      userId,
      currentKeyVersion: 2, // Vault is at v2
      wrappedMasterKeyCiphertext: "cipher",
      wrappedMasterKeyIv: "iv",
      kdfSaltBase64: "salt",
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      createdAt: now,
    };

    store.schedule = {
      id: "sch_1",
      userId,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 0,
      requiredVerifierApprovals: 2, // Requires 2 verifiers, but we only seed 1 below!
      lastCheckInAt: now,
      nextDueAt: new Date(now.getTime() + 90 * 86400000),
      graceEndsAt: null,
      pausedUntil: null,
      releasedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // Outdated Recovery Kit at v1 (vault is at v2)
    store.recoveryArtifacts = [
      {
        id: "rec_stale",
        userId,
        keyVersion: 1,
        recoveryWrappedVmKBase64: "wrapped",
        recoveryWrappedVmKIv: "iv",
        kdfSaltBase64: "salt",
        kdfAlgorithm: "PBKDF2",
        fingerprintHex: "0123456789abcdef",
        isActive: true,
        revokedAt: null,
        lastVerifiedAt: null,
        createdAt: now,
      },
    ];

    // Only 1 verified Trusted Verifier (quorum requires 2) + 1 unverified PENDING_INVITE Beneficiary
    store.contacts = [
      {
        id: "cnt_verifier_1",
        userId,
        fullName: "Sole Verifier",
        email: "v1@example.com",
        phone: null,
        isBeneficiary: false,
        isTrustedVerifier: true,
        status: "VERIFIED",
        inviteTokenHash: null,
        inviteExpiresAt: null,
        verifiedAt: now,
        publicKeyBase64: null,
        keyAlgorithm: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "cnt_ben_pending",
        userId,
        fullName: "Pending Beneficiary",
        email: "pending@example.com",
        phone: null,
        isBeneficiary: true,
        isTrustedVerifier: false,
        status: "PENDING_INVITE",
        inviteTokenHash: "hash",
        inviteExpiresAt: new Date(now.getTime() + 86400000),
        verifiedAt: null,
        publicKeyBase64: null,
        keyAlgorithm: null,
        createdAt: now,
        updatedAt: now,
      },
    ];

    // 1 unassigned item with outdated keyVersion 1 + 1 broken file reference
    store.items = [
      {
        id: "itm_unassigned",
        vaultId: "vlt_1",
        userId,
        folderId: null,
        category: "CRYPTO_RECOVERY",
        isFavorite: false,
        sortOrder: 0,
        schemaVersion: 1,
        keyVersion: 1, // Mismatches vault v2!
        ciphertextBase64: "opaque",
        ivBase64: "iv",
        wrappedItemKeyBase64: "wrapped",
        wrappedItemKeyIvBase64: "iv",
        aadResourceId: "itm_unassigned",
        createdAt: now,
        updatedAt: now,
      },
    ];

    store.files = [
      {
        id: "fil_broken",
        vaultId: "vlt_1",
        userId,
        itemId: "itm_non_existent", // Orphaned item reference!
        storageBlobKey: "blobs/1",
        sizeBytes: 1024,
        ciphertextSha256Hex: "invalid-hash",
        encryptedMetaBase64: "meta",
        metaIvBase64: "iv",
        blobIvBase64: "iv",
        wrappedFileKeyBase64: "key",
        wrappedFileKeyIvBase64: "iv",
        keyVersion: 2,
        createdAt: now,
      },
    ];

    const report = await service.runReleaseSimulationAndReadinessCheck(
      userId,
      now
    );

    // Simulation never marks estate as released
    expect(report.isSimulationOnly).toBe(true);
    expect(report.estateMarkedReleased).toBe(false);
    expect(store.schedule.state).toBe("HEALTHY");
    expect(report.overallReadyForEmergency).toBe(false);

    const byId = Object.fromEntries(report.checklist.map((c) => [c.checkId, c]));
    expect(byId.RECOVERY_KIT_READY.status).toBe("FAIL");
    expect(byId.VERIFIER_QUORUM_POSSIBLE.status).toBe("FAIL");
    expect(byId.BENEFICIARIES_CRYPTO_READY.status).toBe("WARN");
    expect(byId.VAULT_ITEMS_ASSIGNED.status).toBe("WARN");
    expect(byId.KEY_VERSION_CONSISTENCY.status).toBe("FAIL");
    expect(byId.ENCRYPTED_FILES_INTEGRITY_META.status).toBe("FAIL");
  });

  it("2. produces a 100% PASS readiness report and accurate beneficiary package preview when properly configured", async () => {
    store.vault = {
      id: "vlt_ok",
      userId,
      currentKeyVersion: 1,
      wrappedMasterKeyCiphertext: "cipher",
      wrappedMasterKeyIv: "iv",
      kdfSaltBase64: "salt",
      kdfAlgorithm: "PBKDF2-SHA256-600000",
      createdAt: now,
    };

    store.schedule = {
      id: "sch_ok",
      userId,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 0,
      requiredVerifierApprovals: 1,
      lastCheckInAt: now,
      nextDueAt: new Date(now.getTime() + 90 * 86400000),
      graceEndsAt: null,
      pausedUntil: null,
      releasedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    store.recoveryArtifacts = [
      {
        id: "rec_ok",
        userId,
        keyVersion: 1,
        recoveryWrappedVmKBase64: "wrapped",
        recoveryWrappedVmKIv: "iv",
        kdfSaltBase64: "salt",
        kdfAlgorithm: "PBKDF2",
        fingerprintHex: "abcdef0123456789",
        isActive: true,
        revokedAt: null,
        lastVerifiedAt: now,
        createdAt: now,
      },
    ];

    store.contacts = [
      {
        id: "cnt_sarah",
        userId,
        fullName: "Sarah Connor",
        email: "sarah@example.com",
        phone: null,
        isBeneficiary: true,
        isTrustedVerifier: true,
        status: "VERIFIED",
        inviteTokenHash: null,
        inviteExpiresAt: null,
        verifiedAt: now,
        publicKeyBase64: Buffer.alloc(32, 5).toString("base64"),
        keyAlgorithm: "ECDH-P256-HKDF-AES256GCM",
        createdAt: now,
        updatedAt: now,
      },
    ];

    store.items = [
      {
        id: "itm_ok_1",
        vaultId: "vlt_ok",
        userId,
        folderId: null,
        category: "CRYPTO_RECOVERY",
        isFavorite: true,
        sortOrder: 0,
        schemaVersion: 1,
        keyVersion: 1,
        ciphertextBase64: "opaque",
        ivBase64: "iv",
        wrappedItemKeyBase64: "wrapped",
        wrappedItemKeyIvBase64: "iv",
        aadResourceId: "itm_ok_1",
        createdAt: now,
        updatedAt: now,
      },
    ];

    store.assignments = [
      {
        id: "asg_ok_1",
        userId,
        contactId: "cnt_sarah",
        itemId: "itm_ok_1",
        folderId: null,
        beneficiaryWrappedKeyBase64: "wrappedKey",
        beneficiaryWrappedKeyIv: "iv",
        ephemeralPublicKeyBase64: "ephemPub",
        keyVersion: 1,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const report = await service.runReleaseSimulationAndReadinessCheck(
      userId,
      now
    );

    expect(report.overallReadyForEmergency).toBe(true);
    expect(report.readinessScorePercent).toBe(100);
    expect(report.unassignedItemIds).toEqual([]);
    expect(report.beneficiaryPackagesPreview).toHaveLength(1);
    expect(report.beneficiaryPackagesPreview[0].assignedItemIds).toEqual([
      "itm_ok_1",
    ]);
  });
});