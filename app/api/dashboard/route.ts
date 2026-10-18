// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  clearSessionCookie,
  getFoundationService,
  getSessionTokenFromRequest,
} from "@/lib/auth/session-cookie";
import {
  AuthenticationError,
  AuthorizationError,
  TrustBoundaryViolationError,
  ValidationError,
} from "@/lib/services/foundation-service";
import { redactForAuditLog } from "@/lib/domain/trust-boundary";

export async function GET(req: Request) {
  try {
    const token = await getSessionTokenFromRequest(req);
    const service = getFoundationService();
    const { user, session } = await service.authenticateSession(token);

    const [
      vault,
      schedule,
      contacts,
      recoveryArtifacts,
      assignments,
      auditEvents,
    ] = await Promise.all([
      prisma.vault.findUnique({
        where: { userId: user.id },
        include: {
          folders: { orderBy: { sortOrder: "asc" } },
          items: { orderBy: [{ isFavorite: "desc" }, { createdAt: "desc" }] },
        },
      }),
      prisma.checkInSchedule.findUnique({
        where: { userId: user.id },
        include: {
          workflowEvents: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      }),
      prisma.contact.findMany({
        where: { userId: user.id, status: { not: "REVOKED" } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.recoveryArtifact.findMany({
        where: { userId: user.id, isActive: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.releaseAssignment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      }),
      prisma.auditEvent.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 25,
      }),
    ]);

    return NextResponse.json({
      user,
      currentSessionId: session.id,
      vault,
      schedule,
      contacts,
      recoveryArtifacts,
      assignments,
      auditEvents,
    });
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[GET /api/dashboard]", err);
    return NextResponse.json(
      { error: "Failed to load dashboard." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const token = await getSessionTokenFromRequest(req);
    const service = getFoundationService();
    const { user, session } = await service.authenticateSession(token);
    const body = await req.json();

    switch (body.action) {
      case "LOGOUT": {
        await service.revokeUserSession(user.id, session);
        await clearSessionCookie();
        return NextResponse.json({ ok: true });
      }

      case "INIT_VAULT": {
        const vault = await service.createEmptyVault(user.id, body.vaultBundle);
        let recoveryArtifact = null;
        if (body.recoveryServerArtifact) {
          await prisma.recoveryArtifact.updateMany({
            where: { userId: user.id, isActive: true },
            data: { isActive: false, revokedAt: new Date() },
          });
          recoveryArtifact = await prisma.recoveryArtifact.create({
            data: {
              userId: user.id,
              keyVersion: body.recoveryServerArtifact.keyVersion,
              recoveryWrappedVmKBase64:
                body.recoveryServerArtifact.recoveryWrappedVmKBase64,
              recoveryWrappedVmKIv:
                body.recoveryServerArtifact.recoveryWrappedVmKIv,
              kdfSaltBase64: body.recoveryServerArtifact.kdfSaltBase64,
              kdfAlgorithm: body.recoveryServerArtifact.kdfAlgorithm,
              fingerprintHex: body.recoveryServerArtifact.fingerprintHex,
              isActive: true,
            },
          });
          await prisma.auditEvent.create({
            data: {
              userId: user.id,
              eventType: "RECOVERY_KIT_CREATED",
              severity: "CRITICAL",
              actorType: "USER",
              actorId: user.id,
              redactedMeta: JSON.stringify(
                redactForAuditLog({
                  artifactId: recoveryArtifact.id,
                  fingerprintHex: recoveryArtifact.fingerprintHex,
                })
              ),
            },
          });
        }
        return NextResponse.json({ vault, recoveryArtifact }, { status: 201 });
      }

      case "ADD_ENCRYPTED_ITEM": {
        const item = await service.addEncryptedItem(user.id, body.item);
        return NextResponse.json({ item }, { status: 201 });
      }

      case "DELETE_ENCRYPTED_ITEM": {
        const item = await service.getEncryptedItemForOwner(
          user.id,
          body.itemId
        );
        await prisma.encryptedItem.delete({ where: { id: item.id } });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "VAULT_ITEM_DELETED",
            severity: "WARN",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({ itemId: item.id }),
          },
        });
        return NextResponse.json({ ok: true });
      }

      case "ADD_CONTACT": {
        const {
          fullName,
          email,
          phone,
          isBeneficiary,
          isTrustedVerifier,
          publicKeyBase64,
        } = body.contact;

        if (!isBeneficiary && !isTrustedVerifier) {
          throw new ValidationError(
            "A contact must be designated as a Beneficiary, a Trusted Verifier, or both."
          );
        }

        const normalizedEmail = email.trim().toLowerCase();
        const contact = await prisma.contact.upsert({
          where: {
            userId_email: { userId: user.id, email: normalizedEmail },
          },
          update: {
            fullName: fullName.trim(),
            phone: phone?.trim() || null,
            isBeneficiary: Boolean(isBeneficiary),
            isTrustedVerifier: Boolean(isTrustedVerifier),
            status: "VERIFIED",
            verifiedAt: new Date(),
            publicKeyBase64: isBeneficiary ? publicKeyBase64 : null,
            keyAlgorithm: isBeneficiary ? "ECDH-P256-HKDF-AES256GCM" : null,
          },
          create: {
            userId: user.id,
            fullName: fullName.trim(),
            email: normalizedEmail,
            phone: phone?.trim() || null,
            isBeneficiary: Boolean(isBeneficiary),
            isTrustedVerifier: Boolean(isTrustedVerifier),
            status: "VERIFIED",
            verifiedAt: new Date(),
            publicKeyBase64: isBeneficiary ? publicKeyBase64 : null,
            keyAlgorithm: isBeneficiary ? "ECDH-P256-HKDF-AES256GCM" : null,
          },
        });

        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "CONTACT_SAVED",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({
              contactId: contact.id,
              email: contact.email,
              isBeneficiary: contact.isBeneficiary,
              isTrustedVerifier: contact.isTrustedVerifier,
            }),
          },
        });

        return NextResponse.json({ contact }, { status: 201 });
      }

      case "REVOKE_CONTACT": {
        const contact = await prisma.contact.findUnique({
          where: { id: body.contactId },
        });
        if (!contact || contact.userId !== user.id) {
          throw new AuthorizationError("Contact not found.");
        }
        await prisma.releaseAssignment.deleteMany({
          where: { contactId: contact.id },
        });
        await prisma.contact.update({
          where: { id: contact.id },
          data: { status: "REVOKED", publicKeyBase64: null },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "CONTACT_REVOKED",
            severity: "WARN",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({
              contactId: contact.id,
              email: contact.email,
            }),
          },
        });
        return NextResponse.json({ ok: true });
      }

      case "ASSIGN_ITEM_TO_BENEFICIARY": {
        const {
          contactId,
          itemId,
          beneficiaryWrappedKeyBase64,
          beneficiaryWrappedKeyIv,
          ephemeralPublicKeyBase64,
          keyVersion,
        } = body.assignment;

        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
        });
        if (!contact || contact.userId !== user.id || !contact.isBeneficiary) {
          throw new AuthorizationError(
            "Target contact is not a valid Beneficiary."
          );
        }

        const item = await service.getEncryptedItemForOwner(user.id, itemId);

        const assignment = await prisma.releaseAssignment.upsert({
          where: {
            contactId_itemId: { contactId: contact.id, itemId: item.id },
          },
          update: {
            beneficiaryWrappedKeyBase64,
            beneficiaryWrappedKeyIv,
            ephemeralPublicKeyBase64,
            keyVersion,
          },
          create: {
            userId: user.id,
            contactId: contact.id,
            itemId: item.id,
            beneficiaryWrappedKeyBase64,
            beneficiaryWrappedKeyIv,
            ephemeralPublicKeyBase64,
            keyVersion,
          },
        });

        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "BENEFICIARY_ITEM_ASSIGNED",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({
              contactId: contact.id,
              itemId: item.id,
              keyVersion,
            }),
          },
        });

        return NextResponse.json({ assignment }, { status: 201 });
      }

      case "UNASSIGN_ITEM_FROM_BENEFICIARY": {
        const { contactId, itemId } = body;
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
        });
        if (!contact || contact.userId !== user.id) {
          throw new AuthorizationError("Contact not found.");
        }
        await prisma.releaseAssignment.deleteMany({
          where: { contactId, itemId, userId: user.id },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "BENEFICIARY_ITEM_UNASSIGNED",
            severity: "WARN",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({ contactId, itemId }),
          },
        });
        return NextResponse.json({ ok: true });
      }

      case "CHECK_IN_NOW": {
        const current = await prisma.checkInSchedule.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const now = new Date();
        const nextDueAt = new Date(
          now.getTime() + current.intervalDays * 24 * 60 * 60 * 1000
        );
        const updated = await prisma.checkInSchedule.update({
          where: { id: current.id },
          data: {
            state: "HEALTHY",
            lastCheckInAt: now,
            nextDueAt,
            graceEndsAt: null,
            pausedUntil: null,
            remindersSentCount: 0,
            version: { increment: 1 },
          },
        });
        await prisma.workflowEvent.create({
          data: {
            scheduleId: current.id,
            userId: user.id,
            fromState: current.state,
            toState: "HEALTHY",
            reason: "USER_AUTHENTICATED_PROOF_OF_LIFE",
            idempotencyKey: `checkin_${current.id}_v${current.version}_${now.getTime()}`,
            actorType: "USER",
            actorId: user.id,
          },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "PROOF_OF_LIFE_CHECKIN_CONFIRMED",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({
              previousState: current.state,
              nextDueAtIso: nextDueAt.toISOString(),
            }),
          },
        });
        return NextResponse.json({ schedule: updated });
      }

      case "UPDATE_SCHEDULE_CONFIG": {
        const intervalDays = Math.min(
          365,
          Math.max(7, Number(body.intervalDays) || 90)
        );
        const gracePeriodDays = Math.min(
          90,
          Math.max(3, Number(body.gracePeriodDays) || 14)
        );
        const current = await prisma.checkInSchedule.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const now = new Date();
        const nextDueAt = new Date(
          now.getTime() + intervalDays * 24 * 60 * 60 * 1000
        );
        const updated = await prisma.checkInSchedule.update({
          where: { id: current.id },
          data: {
            intervalDays,
            gracePeriodDays,
            state: "HEALTHY",
            lastCheckInAt: now,
            nextDueAt,
            pausedUntil: null,
            version: { increment: 1 },
          },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "CHECKIN_SCHEDULE_CONFIGURED",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({ intervalDays, gracePeriodDays }),
          },
        });
        return NextResponse.json({ schedule: updated });
      }

      case "PAUSE_SCHEDULE": {
        const pauseDays = Math.min(
          180,
          Math.max(1, Number(body.pauseDays) || 14)
        );
        const reason = (body.reason || "Paused by owner").slice(0, 200);
        const current = await prisma.checkInSchedule.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const now = new Date();
        const pausedUntil = new Date(
          now.getTime() + pauseDays * 24 * 60 * 60 * 1000
        );
        const updated = await prisma.checkInSchedule.update({
          where: { id: current.id },
          data: {
            state: "PAUSED",
            pausedUntil,
            version: { increment: 1 },
          },
        });
        await prisma.workflowEvent.create({
          data: {
            scheduleId: current.id,
            userId: user.id,
            fromState: current.state,
            toState: "PAUSED",
            reason: `USER_PAUSED:${reason}`,
            idempotencyKey: `pause_${current.id}_v${current.version}_${now.getTime()}`,
            actorType: "USER",
            actorId: user.id,
          },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "CHECKIN_SCHEDULE_PAUSED",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: JSON.stringify({ pauseDays, reason }),
          },
        });
        return NextResponse.json({ schedule: updated });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof AuthorizationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (
      err instanceof ValidationError ||
      err instanceof TrustBoundaryViolationError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/dashboard]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Operation failed" },
      { status: 500 }
    );
  }
}