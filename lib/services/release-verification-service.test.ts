// lib/services/release-verification-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthorizationError,
  ReleaseHoldActiveError,
  ReleasePolicyNotSatisfiedError,
  ReleaseVerificationService,
  type ReleaseEventRecord,
  type ReleaseVerificationPersistencePort,
} from "./release-verification-service";
import type { ContactRecord } from "./contact-service";
import type {
  DetailedScheduleRecord,
  WorkflowEventRecord,
} from "./checkin-schedule-service";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

class InMemoryReleaseVerificationStore implements ReleaseVerificationPersistencePort {
  public schedules = new Map<string, DetailedScheduleRecord>();
  public contacts = new Map<string, ContactRecord>();
  public releaseEvents: ReleaseEventRecord[] = [];
  public workflowEvents: WorkflowEventRecord[] = [];
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  seedVerificationReadySchedule(
    userId: string,
    requiredVerifierApprovals: number,
    now: Date
  ): DetailedScheduleRecord {
    const rec: DetailedScheduleRecord = {
      id: `sch_${crypto.randomUUID()}`,
      userId,
      state: "VERIFICATION_REQUIRED",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 3,
      requiredVerifierApprovals,
      lastCheckInAt: new Date(now.getTime() - 120 * MS_PER_DAY),
      nextDueAt: new Date(now.getTime() - 30 * MS_PER_DAY),
      graceEndsAt: new Date(now.getTime() - 16 * MS_PER_DAY),
      pausedUntil: null,
      releasedAt: null,
      version: 4,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(rec.id, rec);
    return rec;
  }

  seedContact(params: {
    id: string;
    userId: string;
    email: string;
    isBeneficiary: boolean;
    isTrustedVerifier: boolean;
    now: Date;
  }): ContactRecord {
    const rec: ContactRecord = {
      id: params.id,
      userId: params.userId,
      fullName: params.id,
      email: params.email,
      phone: null,
      isBeneficiary: params.isBeneficiary,
      isTrustedVerifier: params.isTrustedVerifier,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: params.now,
      publicKeyBase64: params.isBeneficiary
        ? Buffer.alloc(32, 7).toString("base64")
        : null,
      keyAlgorithm: params.isBeneficiary ? "ECDH-P256-HKDF-AES256GCM" : null,
      createdAt: params.now,
      updatedAt: params.now,
    };
    this.contacts.set(rec.id, rec);
    return rec;
  }

  async findScheduleById(scheduleId: string): Promise<DetailedScheduleRecord | null> {
    return this.schedules.get(scheduleId) ?? null;
  }

  async findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null> {
    for (const s of this.schedules.values()) {
      if (s.userId === userId) return s;
    }
    return null;
  }

  async findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async listReleaseEventsByScheduleId(scheduleId: string): Promise<ReleaseEventRecord[]> {
    return this.releaseEvents.filter((e) => e.scheduleId === scheduleId);
  }

  async findReleaseEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null> {
    return this.releaseEvents.find((e) => e.actionTokenHash === tokenHash) ?? null;
  }

  async createReleaseEvent(data: {
    scheduleId: string;
    userId: string;
    contactId: string | null;
    eventType: string;
    actionTokenHash?: string | null;
    tokenExpiresAt?: Date | null;
    metadataJson?: string | null;
  }): Promise<ReleaseEventRecord> {
    const rec: ReleaseEventRecord = {
      id: `rev_${crypto.randomUUID()}`,
      scheduleId: data.scheduleId,
      userId: data.userId,
      contactId: data.contactId,
      eventType: data.eventType,
      actionTokenHash: data.actionTokenHash ?? null,
      tokenExpiresAt: data.tokenExpiresAt ?? null,
      tokenUsedAt: null,
      metadataJson: data.metadataJson ?? null,
      createdAt: new Date(),
    };
    this.releaseEvents.push(rec);
    return rec;
  }

  async markReleaseEventTokenUsed(
    eventId: string,
    usedAt: Date
  ): Promise<ReleaseEventRecord> {
    const idx = this.releaseEvents.findIndex((e) => e.id === eventId);
    if (idx === -1) throw new Error("Release event not found");
    const updated = { ...this.releaseEvents[idx], tokenUsedAt: usedAt };
    this.releaseEvents[idx] = updated;
    return updated;
  }

  async updateScheduleState(params: {
    scheduleId: string;
    expectedVersion: number;
    data: Partial<DetailedScheduleRecord>;
    event: {
      userId: string;
      fromState: DetailedScheduleRecord["state"];
      toState: DetailedScheduleRecord["state"];
      reason: string;
      idempotencyKey: string;
      actorType: "USER" | "SYSTEM_SCHEDULER" | "TRUSTED_CONTACT";
      actorId: string | null;
    };
  }): Promise<{
    schedule: DetailedScheduleRecord;
    workflowEvent: WorkflowEventRecord;
  }> {
    const existing = this.schedules.get(params.scheduleId)!;
    const updated: DetailedScheduleRecord = {
      ...existing,
      ...params.data,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.schedules.set(updated.id, updated);

    const wfEvent: WorkflowEventRecord = {
      id: `wfe_${crypto.randomUUID()}`,
      scheduleId: updated.id,
      userId: params.event.userId,
      fromState: params.event.fromState,
      toState: params.event.toState,
      reason: params.event.reason,
      idempotencyKey: params.event.idempotencyKey,
      actorType: params.event.actorType,
      actorId: params.event.actorId,
      createdAt: new Date(),
    };
    this.workflowEvents.push(wfEvent);

    return { schedule: updated, workflowEvent: wfEvent };
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

describe("THE-104: Release Verification & Beneficiary Access Authorization", () => {
  let store: InMemoryReleaseVerificationStore;
  let service: ReleaseVerificationService;
  const ownerId = "usr_estate_owner";
  const now = new Date("2026-10-18T06:00:00Z");

  beforeEach(() => {
    store = new InMemoryReleaseVerificationStore();
    service = new ReleaseVerificationService(store);
  });

  it("1. enforces multi-party verifier approvals, deduplicates repeated votes by the same verifier, and blocks timer-only release", async () => {
    // Require 2 distinct Trusted Verifiers
    const schedule = store.seedVerificationReadySchedule(ownerId, 2, now);
    store.seedContact({
      id: "cnt_verifier_1",
      userId: ownerId,
      email: "v1@example.com",
      isBeneficiary: false,
      isTrustedVerifier: true,
      now,
    });
    store.seedContact({
      id: "cnt_verifier_2",
      userId: ownerId,
      email: "v2@example.com",
      isBeneficiary: false,
      isTrustedVerifier: true,
      now,
    });
    store.seedContact({
      id: "cnt_beneficiary_only",
      userId: ownerId,
      email: "ben@example.com",
      isBeneficiary: true,
      isTrustedVerifier: false,
      now,
    });

    // Attempting release before verifier approvals fails closed
    await expect(
      service.authorizeEstateRelease(schedule.id, now)
    ).rejects.toThrowError(ReleasePolicyNotSatisfiedError);

    // Beneficiary-only contact cannot submit a verifier approval
    await expect(
      service.submitVerifierReleaseApproval({
        scheduleId: schedule.id,
        contactId: "cnt_beneficiary_only",
        verificationStatement: "I want the vault",
      })
    ).rejects.toThrowError(AuthorizationError);

    // Verifier 1 submits approval twice -> deduplicated to 1 unique approval
    const vote1a = await service.submitVerifierReleaseApproval(
      {
        scheduleId: schedule.id,
        contactId: "cnt_verifier_1",
        verificationStatement: "Confirmed death certificate with family",
        externalAdapterType: "DEATH_CERTIFICATE_ATTESTATION",
      },
      now
    );
    const vote1b = await service.submitVerifierReleaseApproval(
      {
        scheduleId: schedule.id,
        contactId: "cnt_verifier_1",
        verificationStatement: "Duplicate submission",
      },
      now
    );
    expect(vote1a.uniqueApprovalsCount).toBe(1);
    expect(vote1b.uniqueApprovalsCount).toBe(1);

    // Still only 1 of 2 required approvals -> authorizeEstateRelease fails closed
    await expect(
      service.authorizeEstateRelease(schedule.id, now)
    ).rejects.toThrowError(ReleasePolicyNotSatisfiedError);

    // Verifier 2 submits approval -> threshold (2/2) reached!
    const vote2 = await service.submitVerifierReleaseApproval(
      {
        scheduleId: schedule.id,
        contactId: "cnt_verifier_2",
        verificationStatement: "Co-verified as estate executor",
        externalAdapterType: "NOTARY_EXECUTOR_ATTESTATION",
      },
      now
    );
    expect(vote2.uniqueApprovalsCount).toBe(2);

    const released = await service.authorizeEstateRelease(schedule.id, now);
    expect(released.state).toBe("RELEASED");
    expect(released.releasedAt).not.toBeNull();
  });

  it("2. blocks release authorization and further approvals when a Release Hold is placed", async () => {
    const schedule = store.seedVerificationReadySchedule(ownerId, 1, now);
    store.seedContact({
      id: "cnt_verifier_1",
      userId: ownerId,
      email: "v1@example.com",
      isBeneficiary: false,
      isTrustedVerifier: true,
      now,
    });

    // Verifier places a Release Hold
    const hold = await service.placeReleaseHold(
      {
        scheduleId: schedule.id,
        actorType: "TRUSTED_CONTACT",
        actorId: "cnt_verifier_1",
        holdReason: "User is in intensive care but alive; hold release",
      },
      now
    );
    expect(hold.schedule.state).toBe("RELEASE_HOLD");

    // Submitting approval while held is blocked
    await expect(
      service.submitVerifierReleaseApproval({
        scheduleId: schedule.id,
        contactId: "cnt_verifier_1",
        verificationStatement: "Trying to approve during hold",
      })
    ).rejects.toThrowError(ReleaseHoldActiveError);

    // Authorizing release while held fails closed
    await expect(
      service.authorizeEstateRelease(schedule.id, now)
    ).rejects.toThrowError(ReleasePolicyNotSatisfiedError);
  });

  it("3. issues time-bounded, replay-resistant beneficiary access grants ONLY after RELEASED and blocks horizontal/replay attacks", async () => {
    const schedule = store.seedVerificationReadySchedule(ownerId, 1, now);
    store.seedContact({
      id: "cnt_verifier_1",
      userId: ownerId,
      email: "v1@example.com",
      isBeneficiary: false,
      isTrustedVerifier: true,
      now,
    });
    store.seedContact({
      id: "cnt_alice",
      userId: ownerId,
      email: "alice@example.com",
      isBeneficiary: true,
      isTrustedVerifier: false,
      now,
    });
    store.seedContact({
      id: "cnt_bob",
      userId: ownerId,
      email: "bob@example.com",
      isBeneficiary: true,
      isTrustedVerifier: false,
      now,
    });

    // Cannot issue beneficiary grant BEFORE estate is RELEASED
    await expect(
      service.issueBeneficiaryAccessGrant({
        scheduleId: schedule.id,
        contactId: "cnt_alice",
        now,
      })
    ).rejects.toThrowError(AuthorizationError);

    // Complete verification and authorize release
    await service.submitVerifierReleaseApproval(
      {
        scheduleId: schedule.id,
        contactId: "cnt_verifier_1",
        verificationStatement: "Verified",
      },
      now
    );
    await service.authorizeEstateRelease(schedule.id, now);

    // Issue grant to Alice
    const aliceGrant = await service.issueBeneficiaryAccessGrant({
      scheduleId: schedule.id,
      contactId: "cnt_alice",
      ttlHours: 24,
      now,
    });

    // Horizontal attack: Bob tries to use Alice's token -> FAILS
    await expect(
      service.verifyAndConsumeBeneficiaryAccessGrant({
        rawAccessToken: aliceGrant.rawAccessToken,
        authenticatedBeneficiaryEmail: "bob@example.com",
        expectedContactId: "cnt_bob",
        now,
      })
    ).rejects.toThrowError(AuthorizationError);

    // Wrong email for Alice's contact -> FAILS
    await expect(
      service.verifyAndConsumeBeneficiaryAccessGrant({
        rawAccessToken: aliceGrant.rawAccessToken,
        authenticatedBeneficiaryEmail: "impersonator@example.com",
        expectedContactId: "cnt_alice",
        now,
      })
    ).rejects.toThrowError(AuthorizationError);

    // Legitimate first use by Alice -> SUCCEEDS
    const consumed = await service.verifyAndConsumeBeneficiaryAccessGrant({
      rawAccessToken: aliceGrant.rawAccessToken,
      authenticatedBeneficiaryEmail: "alice@example.com",
      expectedContactId: "cnt_alice",
      now,
    });
    expect(consumed.contact.id).toBe("cnt_alice");
    expect(consumed.consumedGrant.tokenUsedAt).not.toBeNull();

    // Replay attack: Alice (or attacker with link) tries to reuse the consumed token -> FAILS
    await expect(
      service.verifyAndConsumeBeneficiaryAccessGrant({
        rawAccessToken: aliceGrant.rawAccessToken,
        authenticatedBeneficiaryEmail: "alice@example.com",
        expectedContactId: "cnt_alice",
        now,
      })
    ).rejects.toThrowError(/Replay detected/);
  });
});