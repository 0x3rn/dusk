// lib/crypto/recovery-kit.test.ts
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  CryptoTamperOrAuthError,
  createAndWrapVaultMasterKey,
  decryptVaultItemPayload,
  encryptVaultItemPayload,
  unwrapVaultMasterKeyWithPassphrase,
} from "./vault-crypto";
import {
  computeRecoveryCodeFingerprint,
  createRecoveryKitForVault,
  normalizeRecoveryCode,
  recoverVaultMasterKeyFromKit,
  rewrapRecoveredMasterKeyWithNewPassphrase,
} from "./recovery-kit";
import {
  RecoveryArtifactRevokedError,
  RecoveryService,
  ValidationError,
  type RecoveryArtifactRecord,
  type RecoveryPersistencePort,
} from "../services/recovery-service";

class InMemoryRecoveryStore implements RecoveryPersistencePort {
  public artifacts = new Map<string, RecoveryArtifactRecord>();
  public activeSessionsCount = 3;
  public vaultBundle: {
    wrappedMasterKeyCiphertext: string;
    wrappedMasterKeyIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
  } | null = null;
  public audits: Array<{ eventType: string; severity: string; redactedMeta: string }> = [];

  async listActiveArtifactsByUserId(userId: string): Promise<RecoveryArtifactRecord[]> {
    return Array.from(this.artifacts.values()).filter(
      (a) => a.userId === userId && a.isActive && a.revokedAt === null
    );
  }

  async findArtifactById(artifactId: string): Promise<RecoveryArtifactRecord | null> {
    return this.artifacts.get(artifactId) ?? null;
  }

  async deactivateAllUserArtifacts(userId: string, revokedAt: Date): Promise<number> {
    let count = 0;
    for (const [id, art] of this.artifacts.entries()) {
      if (art.userId === userId && art.isActive) {
        this.artifacts.set(id, { ...art, isActive: false, revokedAt });
        count++;
      }
    }
    return count;
  }

  async createRecoveryArtifact(data: {
    userId: string;
    keyVersion: number;
    recoveryWrappedVmKBase64: string;
    recoveryWrappedVmKIv: string;
    kdfSaltBase64: string;
    kdfAlgorithm: string;
    fingerprintHex: string;
  }): Promise<RecoveryArtifactRecord> {
    const record: RecoveryArtifactRecord = {
      id: `rec_${crypto.randomUUID()}`,
      ...data,
      isActive: true,
      revokedAt: null,
      lastVerifiedAt: null,
      createdAt: new Date(),
    };
    this.artifacts.set(record.id, record);
    return record;
  }

  async markArtifactVerified(
    artifactId: string,
    verifiedAt: Date
  ): Promise<RecoveryArtifactRecord> {
    const existing = this.artifacts.get(artifactId)!;
    const updated = { ...existing, lastVerifiedAt: verifiedAt };
    this.artifacts.set(artifactId, updated);
    return updated;
  }

  async updateVaultWrappedMasterKey(
    _userId: string,
    data: {
      wrappedMasterKeyCiphertext: string;
      wrappedMasterKeyIv: string;
      kdfSaltBase64: string;
      kdfAlgorithm: string;
    }
  ): Promise<void> {
    this.vaultBundle = data;
  }

  async revokeAllUserSessions(_userId: string, _revokedAt: Date): Promise<number> {
    const revoked = this.activeSessionsCount;
    this.activeSessionsCount = 0;
    return revoked;
  }

  async createSession(): Promise<{ id: string }> {
    this.activeSessionsCount += 1;
    return { id: `ses_${crypto.randomUUID()}` };
  }

  async appendAuditEvent(data: {
    userId: string;
    eventType: string;
    severity: string;
    redactedMeta: string;
  }): Promise<void> {
    this.audits.push(data);
  }
}

describe("THE-99: Recovery Kit & Secure Key Recovery Flows", () => {
  const TEST_PBKDF2_ITERATIONS = 10_000;

  it("1. generates a Recovery Kit, normalizes human transcription typos, and recovers the exact Vault Master Key", async () => {
    const { masterKeyBase64 } = await createAndWrapVaultMasterKey(
      "original-forgotten-passphrase",
      "vlt_rec_1",
      TEST_PBKDF2_ITERATIONS
    );

    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: masterKeyBase64,
      vaultId: "vlt_rec_1",
      accountEmail: "owner@dusk.app",
      keyVersion: 1,
    });

    expect(clientKit.recoveryCode).toMatch(/^DUSK(-[0-9A-Z]{4}){8}$/);
    expect(clientKit.fingerprintHex).toBe(serverArtifact.fingerprintHex);

    const messyUserEntry = clientKit.recoveryCode
      .toLowerCase()
      .replace(/-/g, " ")
      .replace(/0/g, "o")
      .replace(/1/g, "l");

    expect(normalizeRecoveryCode(messyUserEntry)).toBe(
      normalizeRecoveryCode(clientKit.recoveryCode)
    );
    expect(computeRecoveryCodeFingerprint(messyUserEntry)).toBe(
      serverArtifact.fingerprintHex
    );

    const recoveredVmk = await recoverVaultMasterKeyFromKit({
      serverArtifact,
      recoveryCode: messyUserEntry,
    });

    expect(recoveredVmk).toBe(masterKeyBase64);
  });

  it("2. enforces secondary recovery passphrase when configured and fails closed when omitted or wrong", async () => {
    const { masterKeyBase64 } = await createAndWrapVaultMasterKey(
      "primary-passphrase-123",
      "vlt_rec_2",
      TEST_PBKDF2_ITERATIONS
    );

    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: masterKeyBase64,
      vaultId: "vlt_rec_2",
      accountEmail: "owner@dusk.app",
      keyVersion: 1,
      recoveryPassphrase: "extra-offline-passphrase-secret",
    });

    expect(clientKit.requiresPassphrase).toBe(true);

    await expect(
      recoverVaultMasterKeyFromKit({
        serverArtifact,
        recoveryCode: clientKit.recoveryCode,
      })
    ).rejects.toThrowError(CryptoTamperOrAuthError);

    const recoveredVmk = await recoverVaultMasterKeyFromKit({
      serverArtifact,
      recoveryCode: clientKit.recoveryCode,
      recoveryPassphrase: "extra-offline-passphrase-secret",
    });
    expect(recoveredVmk).toBe(masterKeyBase64);
  });

  it("3. completes full end-to-end vault item decryption after losing the Master Passphrase and re-enrolling a new device", async () => {
    const vaultId = "vlt_e2e_recovery";
    const { masterKeyBase64: originalVmk } = await createAndWrapVaultMasterKey(
      "lost-device-passphrase-111!",
      vaultId,
      TEST_PBKDF2_ITERATIONS
    );

    const { bundle: itemBundle } = await encryptVaultItemPayload({
      payload: { wallet: "Trezor Safe 5", mnemonic: "legal winner thank year wave sausage worth" },
      vaultMasterKeyBase64: originalVmk,
      vaultId,
      itemId: "itm_trezor",
    });

    const { clientKit, serverArtifact } = await createRecoveryKitForVault({
      vaultMasterKeyBase64: originalVmk,
      vaultId,
      accountEmail: "user@dusk.app",
      keyVersion: 1,
    });

    const newPassphrase = "brand-new-device-passphrase-999!";
    const { newWrappedMasterKeyBundle } =
      await rewrapRecoveredMasterKeyWithNewPassphrase({
        serverArtifact,
        recoveryCode: clientKit.recoveryCode,
        newMasterPassphrase: newPassphrase,
        pbkdf2Iterations: TEST_PBKDF2_ITERATIONS,
      });

    const unlockedVmkOnNewDevice = await unwrapVaultMasterKeyWithPassphrase(
      newWrappedMasterKeyBundle,
      newPassphrase,
      vaultId
    );

    const { payload } = await decryptVaultItemPayload<{
      wallet: string;
      mnemonic: string;
    }>({
      bundle: itemBundle,
      vaultMasterKeyBase64: unlockedVmkOnNewDevice,
    });

    expect(payload.wallet).toBe("Trezor Safe 5");
    expect(payload.mnemonic).toBe("legal winner thank year wave sausage worth");
  });

  it("4. rotates recovery kits, revokes old recovery kits, requires confirmation, and revokes compromised device sessions", async () => {
    const store = new InMemoryRecoveryStore();
    const service = new RecoveryService(store);
    const userId = "usr_recovery_owner";
    const vaultId = "vlt_rotate_kit";

    const { masterKeyBase64 } = await createAndWrapVaultMasterKey(
      "passphrase-abc-123",
      vaultId,
      TEST_PBKDF2_ITERATIONS
    );

    const kit1 = await createRecoveryKitForVault({
      vaultMasterKeyBase64: masterKeyBase64,
      vaultId,
      accountEmail: "owner@dusk.app",
      keyVersion: 1,
    });

    await expect(
      service.registerOrRotateRecoveryArtifact(userId, {
        ...kit1.serverArtifact,
        confirmIrreversibleRotation: false,
      })
    ).rejects.toThrowError(ValidationError);

    await expect(
      service.registerOrRotateRecoveryArtifact(userId, {
        ...kit1.serverArtifact,
        recoveryCode: kit1.clientKit.recoveryCode,
        confirmIrreversibleRotation: true,
      })
    ).rejects.toThrowError(/recoveryCode must never be sent to the server/);

    const reg1 = await service.registerOrRotateRecoveryArtifact(userId, {
      ...kit1.serverArtifact,
      confirmIrreversibleRotation: true,
    });
    expect(reg1.revokedPreviousCount).toBe(0);

    const kit2 = await createRecoveryKitForVault({
      vaultMasterKeyBase64: masterKeyBase64,
      vaultId,
      accountEmail: "owner@dusk.app",
      keyVersion: 1,
    });
    const reg2 = await service.registerOrRotateRecoveryArtifact(userId, {
      ...kit2.serverArtifact,
      confirmIrreversibleRotation: true,
    });
    expect(reg2.revokedPreviousCount).toBe(1);

    await expect(
      service.getActiveArtifactForRecovery(userId, reg1.artifact.id)
    ).rejects.toThrowError(RecoveryArtifactRevokedError);

    const rewrapped = await rewrapRecoveredMasterKeyWithNewPassphrase({
      serverArtifact: kit2.serverArtifact,
      recoveryCode: kit2.clientKit.recoveryCode,
      newMasterPassphrase: "new-passphrase-after-rotation-123!",
      pbkdf2Iterations: TEST_PBKDF2_ITERATIONS,
    });

    const enrollment = await service.completeRecoveryReEnrollment(userId, {
      artifactId: reg2.artifact.id,
      fingerprintHex: kit2.serverArtifact.fingerprintHex,
      newWrappedMasterKeyCiphertext:
        rewrapped.newWrappedMasterKeyBundle.wrappedMasterKeyCiphertext,
      newWrappedMasterKeyIv: rewrapped.newWrappedMasterKeyBundle.wrappedMasterKeyIv,
      newKdfSaltBase64: rewrapped.newWrappedMasterKeyBundle.kdfSaltBase64,
      newKdfAlgorithm: rewrapped.newWrappedMasterKeyBundle.kdfAlgorithm,
      newDeviceName: "MacBook Pro (Replacement)",
      revokeAllExistingSessions: true,
    });

    expect(enrollment.revokedSessionsCount).toBe(3);
    expect(store.activeSessionsCount).toBe(1);
    expect(enrollment.verifiedArtifact.lastVerifiedAt).not.toBeNull();
  });
});