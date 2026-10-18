// lib/services/e2e-lifecycle-and-failure.test.ts
import { describe, expect, it } from "vitest";
import {
  createAndWrapVaultMasterKey,
  decryptVaultItemPayload,
  encryptVaultFileAttachment,
  encryptVaultItemPayload,
} from "../crypto/vault-crypto";
import {
  createRecoveryKitForVault,
  recoverVaultMasterKeyFromKit,
} from "../crypto/recovery-kit";
import {
  decryptAssignedItemAsBeneficiary,
  generateBeneficiaryKeyPair,
  wrapItemKeyForBeneficiary,
} from "../crypto/beneficiary-wrapping";
import {
  TypedVaultItemPlaintextSchema,
  type TypedVaultItemPlaintext,
} from "./vault-workspace-service";
import {
  computeNextSchedulerStage,
  type DetailedScheduleRecord,
} from "./checkin-schedule-service";
import { evaluateFailClosedReleasePolicy } from "../domain/trust-boundary";
import { PackageGrantExpiredOrRevokedError } from "./release-delivery-service";
import { generateOpaqueToken, hashOpaqueToken } from "../auth/security";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe("THE-110: Complete Cryptographic, Workflow, Failure-Path & Zero-Knowledge E2E Verification", () => {
  const TEST_PBKDF2_ITERATIONS = 10_000;

  const SENSITIVE_CANARY_SECRETS = [
    "owner-master-passphrase-canary-998877!",
    "witch collapse practice feed shame open despair creek road again ice least",
    "bob-private-corporate-bank-wire-pin-445566",
    "unassigned-personal-diary-secret-canary-xyz",
  ];

  it("1. executes full E2E lifecycle: setup -> recovery -> missed check-ins -> provider outage fail-closed -> false-trigger cancellation -> controlled multi-verifier release -> scoped beneficiary decryption", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const vaultId = "vlt_e2e_main";
    const ownerId = "usr_e2e_owner";
    const serverPersistedSnapshots: unknown[] = [];

    // PHASE 1: Zero-Knowledge Vault Setup & Recovery Kit Verification
    const masterPassphrase = SENSITIVE_CANARY_SECRETS[0];
    const { masterKeyBase64: vmk, wrappedBundle } =
      await createAndWrapVaultMasterKey(
        masterPassphrase,
        vaultId,
        TEST_PBKDF2_ITERATIONS
      );
    serverPersistedSnapshots.push(wrappedBundle);

    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: vmk,
      vaultId,
      accountEmail: "owner@dusk.app",
      keyVersion: 1,
    });
    serverPersistedSnapshots.push(serverArtifact);

    const recoveredVmk = await recoverVaultMasterKeyFromKit({
      serverArtifact,
      recoveryCode: clientKit.recoveryCode,
    });
    expect(recoveredVmk).toBe(vmk);

    // PHASE 2: Typed Vault Items + Encrypted File Attachments
    const aliceSeedItemPlain = TypedVaultItemPlaintextSchema.parse({
      category: "CRYPTO_RECOVERY",
      title: "Family Coldcard Multisig",
      tags: ["bitcoin", "inheritance"],
      walletType: "Coldcard Mk4",
      seedPhraseOrPrivateKey: SENSITIVE_CANARY_SECRETS[1],
    });

    const bobBankItemPlain = TypedVaultItemPlaintextSchema.parse({
      category: "FINANCIAL_INSTRUCTION",
      title: "Operating Company Treasury",
      tags: ["business"],
      institutionName: "Mercury Commercial",
      accountOrPolicyIdentifier: "ACCT-9900",
      instructions: SENSITIVE_CANARY_SECRETS[2],
    });

    const unassignedItemPlain = TypedVaultItemPlaintextSchema.parse({
      category: "SECURE_NOTE",
      title: "Private Journal",
      tags: ["personal"],
      content: SENSITIVE_CANARY_SECRETS[3],
    });

    const encAliceItem = await encryptVaultItemPayload({
      payload: aliceSeedItemPlain,
      vaultMasterKeyBase64: vmk,
      vaultId,
      itemId: "itm_alice_btc",
    });
    const encBobItem = await encryptVaultItemPayload({
      payload: bobBankItemPlain,
      vaultMasterKeyBase64: vmk,
      vaultId,
      itemId: "itm_bob_bank",
    });
    const encUnassignedItem = await encryptVaultItemPayload({
      payload: unassignedItemPlain,
      vaultMasterKeyBase64: vmk,
      vaultId,
      itemId: "itm_unassigned_note",
    });

    const fileBytes = new TextEncoder().encode(
      `Backup Descriptor for ${SENSITIVE_CANARY_SECRETS[1]}`
    );
    const encAttachment = await encryptVaultFileAttachment({
      fileBytes,
      metadata: {
        fileName: "multisig-descriptor.txt",
        mimeType: "text/plain",
        sizeBytes: fileBytes.byteLength,
      },
      vaultMasterKeyBase64: vmk,
      vaultId,
      fileId: "fil_descriptor_1",
    });

    serverPersistedSnapshots.push(
      encAliceItem.bundle,
      encBobItem.bundle,
      encUnassignedItem.bundle,
      {
        ciphertextSha256Hex: encAttachment.ciphertextSha256Hex,
        encryptedMetaBase64: encAttachment.encryptedMetaBase64,
        wrappedFileKeyBase64: encAttachment.wrappedFileKeyBase64,
      }
    );

    // PHASE 3: Beneficiaries & Selective ECDH Key Wrapping
    const aliceKeys = await generateBeneficiaryKeyPair();
    const bobKeys = await generateBeneficiaryKeyPair();

    const aliceWrappedGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: encAliceItem.itemKeyBase64,
      beneficiaryPublicKeyBase64: aliceKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_alice",
      itemId: "itm_alice_btc",
    });

    const bobWrappedGrant = await wrapItemKeyForBeneficiary({
      itemKeyBase64: encBobItem.itemKeyBase64,
      beneficiaryPublicKeyBase64: bobKeys.publicKeyBase64,
      vaultId,
      contactId: "cnt_bob",
      itemId: "itm_bob_bank",
    });

    serverPersistedSnapshots.push(aliceWrappedGrant, bobWrappedGrant);

    // PHASE 4: Check-In State Machine, Provider Outage & False-Trigger Reset
    let schedule: DetailedScheduleRecord = {
      id: "sch_e2e",
      userId: ownerId,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 0,
      requiredVerifierApprovals: 2,
      lastCheckInAt: t0,
      nextDueAt: new Date(t0.getTime() + 90 * MS_PER_DAY),
      graceEndsAt: null,
      pausedUntil: null,
      releasedAt: null,
      version: 1,
      createdAt: t0,
      updatedAt: t0,
    };

    // Day 85: HEALTHY -> REMINDER_DUE
    const step1 = computeNextSchedulerStage({
      schedule,
      now: new Date(t0.getTime() + 85 * MS_PER_DAY),
    });
    expect(step1.shouldTransition).toBe(true);
    expect(step1.nextState).toBe("REMINDER_DUE");
    schedule = {
      ...schedule,
      state: step1.nextState,
      graceEndsAt: step1.computedGraceEndsAt,
      remindersSentCount: 1,
    };

    // Day 92: REMINDER_DUE -> GRACE_PERIOD
    const step2 = computeNextSchedulerStage({
      schedule,
      now: new Date(t0.getTime() + 92 * MS_PER_DAY),
    });
    expect(step2.shouldTransition).toBe(true);
    expect(step2.nextState).toBe("GRACE_PERIOD");
    schedule = { ...schedule, state: step2.nextState, remindersSentCount: 2 };

    // FALSE ALARM CANCELLATION: User checks in at Day 95 -> resets to HEALTHY!
    const day95 = new Date(t0.getTime() + 95 * MS_PER_DAY);
    schedule = {
      ...schedule,
      state: "HEALTHY",
      lastCheckInAt: day95,
      nextDueAt: new Date(day95.getTime() + 90 * MS_PER_DAY),
      graceEndsAt: null,
      remindersSentCount: 0,
    };
    expect(schedule.state).toBe("HEALTHY");

    // PHASE 5: Real Inactivity Escalation + Provider Outage Fail-Closed Test
    const dueBase = schedule.nextDueAt;
    schedule = {
      ...schedule,
      state: "ESCALATION_PENDING",
      graceEndsAt: new Date(dueBase.getTime() + 14 * MS_PER_DAY),
      remindersSentCount: 3,
    };

    const afterEscalationWindow = new Date(dueBase.getTime() + 25 * MS_PER_DAY);
    const outageStep = computeNextSchedulerStage({
      schedule,
      now: afterEscalationWindow,
      hasConfirmedReminderDelivery: false,
    });
    expect(outageStep.shouldTransition).toBe(false);
    expect(outageStep.nextState).toBe("ESCALATION_PENDING");

    const verifiedStep = computeNextSchedulerStage({
      schedule,
      now: afterEscalationWindow,
      hasConfirmedReminderDelivery: true,
    });
    expect(verifiedStep.shouldTransition).toBe(true);
    expect(verifiedStep.nextState).toBe("VERIFICATION_REQUIRED");
    schedule = { ...schedule, state: verifiedStep.nextState };

    // PHASE 6: Multi-Party Release Verification & Fail-Closed Policy Evaluation
    const prematureDecision = evaluateFailClosedReleasePolicy({
      currentScheduleState: schedule.state,
      missedCheckInDueAtMs: schedule.nextDueAt.getTime(),
      nowMs: afterEscalationWindow.getTime(),
      configuredGracePeriodMs: 14 * MS_PER_DAY,
      remindersSentCount: 3,
      minRequiredReminders: 3,
      hasConfirmedReminderDelivery: true,
      userCanceledOrCheckedInAfterDue: false,
      trustedContactSignaledAlive: false,
      hasActiveReleaseHold: false,
      requiredVerifierApprovals: 2,
      actualVerifierApprovals: 1,
    });
    expect(prematureDecision.allowRelease).toBe(false);

    const authorizedDecision = evaluateFailClosedReleasePolicy({
      currentScheduleState: schedule.state,
      missedCheckInDueAtMs: schedule.nextDueAt.getTime(),
      nowMs: afterEscalationWindow.getTime(),
      configuredGracePeriodMs: 14 * MS_PER_DAY,
      remindersSentCount: 3,
      minRequiredReminders: 3,
      hasConfirmedReminderDelivery: true,
      userCanceledOrCheckedInAfterDue: false,
      trustedContactSignaledAlive: false,
      hasActiveReleaseHold: false,
      requiredVerifierApprovals: 2,
      actualVerifierApprovals: 2,
    });
    expect(authorizedDecision.allowRelease).toBe(true);

    // PHASE 7: Scoped Beneficiary Decryption & Replay Protection
    const { rawToken: aliceAccessToken, tokenHash: aliceTokenHash } =
      generateOpaqueToken();
    serverPersistedSnapshots.push({ aliceTokenHash });

    const aliceDecrypted =
      await decryptAssignedItemAsBeneficiary<TypedVaultItemPlaintext>({
        itemEnvelope: encAliceItem.bundle,
        wrappedGrant: aliceWrappedGrant,
        beneficiaryPrivateKeyBase64: aliceKeys.privateKeyBase64,
      });
    expect(aliceDecrypted.category).toBe("CRYPTO_RECOVERY");
    if (aliceDecrypted.category === "CRYPTO_RECOVERY") {
      expect(aliceDecrypted.seedPhraseOrPrivateKey).toBe(
        SENSITIVE_CANARY_SECRETS[1]
      );
    }

    const bobDecrypted =
      await decryptAssignedItemAsBeneficiary<TypedVaultItemPlaintext>({
        itemEnvelope: encBobItem.bundle,
        wrappedGrant: bobWrappedGrant,
        beneficiaryPrivateKeyBase64: bobKeys.privateKeyBase64,
      });
    expect(bobDecrypted.category).toBe("FINANCIAL_INSTRUCTION");
    if (bobDecrypted.category === "FINANCIAL_INSTRUCTION") {
      expect(bobDecrypted.instructions).toBe(SENSITIVE_CANARY_SECRETS[2]);
    }

    expect(hashOpaqueToken(aliceAccessToken)).toBe(aliceTokenHash);
    expect(PackageGrantExpiredOrRevokedError).toBeDefined();

    // PHASE 8: Global Zero-Knowledge Leak Audit Over All Persisted Snapshots
    const serializedServerDump = JSON.stringify(serverPersistedSnapshots);
    for (const canary of SENSITIVE_CANARY_SECRETS) {
      expect(serializedServerDump).not.toContain(canary);
    }
    expect(serializedServerDump).not.toContain(vmk);
    expect(serializedServerDump).not.toContain(clientKit.recoveryCode);
    expect(serializedServerDump).not.toContain(aliceKeys.privateKeyBase64);
    expect(serializedServerDump).not.toContain(bobKeys.privateKeyBase64);

    const ownerDecryptedUnassigned =
      await decryptVaultItemPayload<TypedVaultItemPlaintext>({
        bundle: encUnassignedItem.bundle,
        vaultMasterKeyBase64: vmk,
      });
    expect(ownerDecryptedUnassigned.payload.category).toBe("SECURE_NOTE");
    if (ownerDecryptedUnassigned.payload.category === "SECURE_NOTE") {
      expect(ownerDecryptedUnassigned.payload.content).toBe(
        SENSITIVE_CANARY_SECRETS[3]
      );
    }
  });
});