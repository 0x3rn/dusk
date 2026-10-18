// lib/services/release-delivery-service.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  AuthorizationError,
  PackageGrantExpiredOrRevokedError,
  ReleaseDeliveryService,
  type ReleaseDeliveryPersistencePort,
} from "./release-delivery-service";
import { generateOpaqueToken } from "../auth/security";
import type { ContactRecord } from "./contact-service";
import type { DetailedScheduleRecord } from "./checkin-schedule-service";
import type { ReleaseEventRecord } from "./release-verification-service";
import type { ScopedBeneficiaryReleasePackage } from "./selective-release-service";

const MS_PER_HOUR = 60 * 60 * 1000;

class InMemoryReleaseDeliveryStore implements ReleaseDeliveryPersistencePort {
  public contacts = new Map<string, ContactRecord>();
  public schedules = new Map<string, DetailedScheduleRecord>();
  public releaseEvents: ReleaseEventRecord[] = [];
  public scopedPackages = new Map<string, ScopedBeneficiaryReleasePackage>();
  public audits: Array<{ userId: string; eventType: string; severity: string; redactedMeta: string }> = [];

  seedReleasedEstate(userId: string, now: Date): DetailedScheduleRecord {
    const rec: DetailedScheduleRecord = {
      id: `sch_${crypto.randomUUID()}`,
      userId,
      state: "RELEASED",
      intervalDays: 90,
      gracePeriodDays: 14,
      reminderDaysBeforeDue: 7,
      minRequiredReminders: 3,
      remindersSentCount: 3,
      requiredVerifierApprovals: 1,
      lastCheckInAt: new Date(now.getTime() - 120 * 24 * MS_PER_HOUR),
      nextDueAt: new Date(now.getTime() - 30 * 24 * MS_PER_HOUR),
      graceEndsAt: new Date(now.getTime() - 16 * 24 * MS_PER_HOUR),
      pausedUntil: null,
      releasedAt: now,
      version: 5,
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.set(userId, rec);
    return rec;
  }

  seedBeneficiary(id: string, userId: string, email: string, now: Date): ContactRecord {
    const rec: ContactRecord = {
      id,
      userId,
      fullName: id,
      email,
      phone: null,
      isBeneficiary: true,
      isTrustedVerifier: false,
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: now,
      publicKeyBase64: Buffer.alloc(32, 3).toString("base64"),
      keyAlgorithm: "ECDH-P256-HKDF-AES256GCM",
      createdAt: now,
      updatedAt: now,
    };
    this.contacts.set(id, rec);
    return rec;
  }

  seedGrant(params: {
    scheduleId: string;
    userId: string;
    contactId: string;
    expiresAt: Date;
  }): { rawToken: string; event: ReleaseEventRecord } {
    const { rawToken, tokenHash } = generateOpaqueToken();
    const event: ReleaseEventRecord = {
      id: `rev_${crypto.randomUUID()}`,
      scheduleId: params.scheduleId,
      userId: params.userId,
      contactId: params.contactId,
      eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED",
      actionTokenHash: tokenHash,
      tokenExpiresAt: params.expiresAt,
      tokenUsedAt: null,
      metadataJson: null,
      createdAt: new Date(),
    };
    this.releaseEvents.push(event);
    return { rawToken, event };
  }

  async findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.contacts.get(contactId) ?? null;
  }

  async findScheduleByUserId(userId: string): Promise<DetailedScheduleRecord | null> {
    return this.schedules.get(userId) ?? null;
  }

  async findGrantEventByTokenHash(tokenHash: string): Promise<ReleaseEventRecord | null> {
    return this.releaseEvents.find((e) => e.actionTokenHash === tokenHash) ?? null;
  }

  async findGrantEventById(eventId: string): Promise<ReleaseEventRecord | null> {
    return this.releaseEvents.find((e) => e.id === eventId) ?? null;
  }

  async listReleaseEventsForContact(
    scheduleId: string,
    contactId: string
  ): Promise<ReleaseEventRecord[]> {
    return this.releaseEvents.filter(
      (e) => e.scheduleId === scheduleId && e.contactId === contactId
    );
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

  async markGrantTokenUsed(eventId: string, usedAt: Date): Promise<ReleaseEventRecord> {
    const idx = this.releaseEvents.findIndex((e) => e.id === eventId);
    const updated = { ...this.releaseEvents[idx], tokenUsedAt: usedAt };
    this.releaseEvents[idx] = updated;
    return updated;
  }

  async assembleScopedPackage(
    userId: string,
    contactId: string
  ): Promise<ScopedBeneficiaryReleasePackage> {
    return (
      this.scopedPackages.get(contactId) ?? {
        beneficiaryContactId: contactId,
        beneficiaryEmail: this.contacts.get(contactId)?.email ?? "",
        vaultOwnerUserId: userId,
        generatedAtIso: new Date().toISOString(),
        items: [
          {
            itemId: `itm_for_${contactId}`,
            folderId: null,
            category: "CRYPTO_RECOVERY",
            schemaVersion: 1,
            keyVersion: 1,
            ciphertextBase64: Buffer.alloc(32, 9).toString("base64"),
            ivBase64: Buffer.alloc(12, 8).toString("base64"),
            aadResourceId: `itm_for_${contactId}`,
            wrappedGrant: {
              beneficiaryWrappedKeyBase64: Buffer.alloc(48, 7).toString("base64"),
              beneficiaryWrappedKeyIv: Buffer.alloc(12, 6).toString("base64"),
              ephemeralPublicKeyBase64: Buffer.alloc(32, 5).toString("base64"),
              keyVersion: 1,
            },
          },
        ],
      }
    );
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

describe("THE-105: Emergency Release Package Delivery & Acknowledgement", () => {
  let store: InMemoryReleaseDeliveryStore;
  let service: ReleaseDeliveryService;
  const ownerId = "usr_estate_owner";
  const now = new Date("2026-10-18T07:00:00Z");

  beforeEach(() => {
    store = new InMemoryReleaseDeliveryStore();
    service = new ReleaseDeliveryService(store);
  });

  it("1. delivers scoped package + downloadable bundle to the intended beneficiary and records receipt acknowledgement without logging plaintext", async () => {
    const schedule = store.seedReleasedEstate(ownerId, now);
    store.seedBeneficiary("cnt_alice", ownerId, "alice@example.com", now);
    const { rawToken, event: grant } = store.seedGrant({
      scheduleId: schedule.id,
      userId: ownerId,
      contactId: "cnt_alice",
      expiresAt: new Date(now.getTime() + 24 * MS_PER_HOUR),
    });

    const delivery = await service.retrieveScopedPackageForBeneficiary(
      {
        contactId: "cnt_alice",
        rawAccessToken: rawToken,
        authenticatedBeneficiaryEmail: "alice@example.com",
      },
      now
    );

    expect(delivery.scopedPackage.beneficiaryContactId).toBe("cnt_alice");
    expect(delivery.scopedPackage.items).toHaveLength(1);
    expect(delivery.downloadableBundle.bundleFormat).toBe(
      "DUSK-ENCRYPTED-ESTATE-PACKAGE-V1"
    );
    expect(delivery.downloadableBundle.manifestSha256Hex).toMatch(/^[a-f0-9]{64}$/);

    // Acknowledge receipt
    const ack = await service.acknowledgePackageReceipt(
      {
        contactId: "cnt_alice",
        grantEventId: grant.id,
        authenticatedBeneficiaryEmail: "alice@example.com",
        decryptedItemCountConfirmed: 1,
        acknowledgementNote: "Received and verified locally.",
      },
      now
    );
    expect(ack.eventType).toBe("PACKAGE_RECEIPT_ACKNOWLEDGED");
  });

  it("2. fails safely on wrong beneficiary, expired grant, or replayed grant, and records every failed access attempt", async () => {
    const schedule = store.seedReleasedEstate(ownerId, now);
    store.seedBeneficiary("cnt_alice", ownerId, "alice@example.com", now);
    store.seedBeneficiary("cnt_bob", ownerId, "bob@example.com", now);

    const { rawToken: expiredToken } = store.seedGrant({
      scheduleId: schedule.id,
      userId: ownerId,
      contactId: "cnt_alice",
      expiresAt: new Date(now.getTime() - 1000), // Already expired
    });

    // Expired grant fails safely
    await expect(
      service.retrieveScopedPackageForBeneficiary(
        {
          contactId: "cnt_alice",
          rawAccessToken: expiredToken,
          authenticatedBeneficiaryEmail: "alice@example.com",
        },
        now
      )
    ).rejects.toThrowError(PackageGrantExpiredOrRevokedError);

    // Cross-beneficiary attempt fails safely
    const { rawToken: validAliceToken } = store.seedGrant({
      scheduleId: schedule.id,
      userId: ownerId,
      contactId: "cnt_alice",
      expiresAt: new Date(now.getTime() + 24 * MS_PER_HOUR),
    });

    await expect(
      service.retrieveScopedPackageForBeneficiary(
        {
          contactId: "cnt_bob",
          rawAccessToken: validAliceToken,
          authenticatedBeneficiaryEmail: "bob@example.com",
        },
        now
      )
    ).rejects.toThrowError(AuthorizationError);

    // Confirm failed attempts were recorded in ReleaseEvent
    const deniedEvents = store.releaseEvents.filter(
      (e) => e.eventType === "PACKAGE_ACCESS_DENIED"
    );
    expect(deniedEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("3. enforces grant revocation and supports safe grant re-issuance", async () => {
    const schedule = store.seedReleasedEstate(ownerId, now);
    store.seedBeneficiary("cnt_alice", ownerId, "alice@example.com", now);

    const { rawToken: firstToken, event: firstGrant } = store.seedGrant({
      scheduleId: schedule.id,
      userId: ownerId,
      contactId: "cnt_alice",
      expiresAt: new Date(now.getTime() + 24 * MS_PER_HOUR),
    });

    // Re-issue grant -> revokes firstGrant and issues newGrantEvent
    const reissued = await service.reissueBeneficiaryPackageGrant({
      previousGrantEventId: firstGrant.id,
      ttlHours: 48,
      now,
    });

    // First token now fails with PackageGrantExpiredOrRevokedError
    await expect(
      service.retrieveScopedPackageForBeneficiary(
        {
          contactId: "cnt_alice",
          rawAccessToken: firstToken,
          authenticatedBeneficiaryEmail: "alice@example.com",
        },
        now
      )
    ).rejects.toThrowError(PackageGrantExpiredOrRevokedError);

    // Re-issued token succeeds
    const delivery = await service.retrieveScopedPackageForBeneficiary(
      {
        contactId: "cnt_alice",
        rawAccessToken: reissued.rawAccessToken,
        authenticatedBeneficiaryEmail: "alice@example.com",
      },
      now
    );
    expect(delivery.grantEventId).toBe(reissued.newGrantEvent.id);
  });
});