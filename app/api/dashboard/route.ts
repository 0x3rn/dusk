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
          items: { orderBy: { createdAt: "desc" } },
        },
      }),
      prisma.checkInSchedule.findUnique({
        where: { userId: user.id },
        include: {
          workflowEvents: { orderBy: { createdAt: "desc" }, take: 10 },
          releaseEvents: { orderBy: { createdAt: "desc" }, take: 10 },
        },
      }),
      prisma.contact.findMany({
        where: { userId: user.id },
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
        take: 20,
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
      { error: "Failed to load dashboard state." },
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

      case "INVITE_CONTACT": {
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
            "Contact must be a Beneficiary, a Trusted Verifier, or both."
          );
        }
        const contact = await prisma.contact.create({
          data: {
            userId: user.id,
            fullName,
            email: email.trim().toLowerCase(),
            phone: phone || null,
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
            eventType: "CONTACT_VERIFIED",
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

      case "ASSIGN_ITEM_TO_BENEFICIARY": {
        const {
          contactId,
          itemId,
          beneficiaryWrappedKeyBase64,
          beneficiaryWrappedKeyIv,
          ephemeralPublicKeyBase64,
          keyVersion,
        } = body.assignment;

        const assignment = await prisma.releaseAssignment.upsert({
          where: {
            contactId_itemId: { contactId, itemId },
          },
          update: {
            beneficiaryWrappedKeyBase64,
            beneficiaryWrappedKeyIv,
            ephemeralPublicKeyBase64,
            keyVersion,
          },
          create: {
            userId: user.id,
            contactId,
            itemId,
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
              contactId,
              itemId,
              keyVersion,
            }),
          },
        });

        return NextResponse.json({ assignment }, { status: 201 });
      }

      // THE-102: Authenticated Proof-of-Life Check-In
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

      // THE-102: Advance 1 stage in state machine to test escalation in localhost
      case "ADVANCE_STAGE_STEP": {
        const current = await prisma.checkInSchedule.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const stageOrder = [
          "HEALTHY",
          "REMINDER_DUE",
          "GRACE_PERIOD",
          "ESCALATION_PENDING",
          "VERIFICATION_REQUIRED",
        ] as const;
        const idx = stageOrder.indexOf(current.state as any);
        const nextState =
          idx >= 0 && idx < stageOrder.length - 1
            ? stageOrder[idx + 1]
            : "VERIFICATION_REQUIRED";

        const now = new Date();
        const updated = await prisma.checkInSchedule.update({
          where: { id: current.id },
          data: {
            state: nextState,
            remindersSentCount: { increment: 1 },
            graceEndsAt:
              current.graceEndsAt ??
              new Date(
                now.getTime() + current.gracePeriodDays * 24 * 60 * 60 * 1000
              ),
            version: { increment: 1 },
          },
        });
        await prisma.workflowEvent.create({
          data: {
            scheduleId: current.id,
            userId: user.id,
            fromState: current.state,
            toState: nextState,
            reason: `SCHEDULER_STAGE_TRANSITION_TO_${nextState}`,
            idempotencyKey: `step_${current.id}_v${current.version}_${now.getTime()}`,
            actorType: "SYSTEM_SCHEDULER",
            actorId: null,
          },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: `WORKFLOW_STATE_${nextState}`,
            severity: "WARN",
            actorType: "SYSTEM",
            redactedMeta: JSON.stringify({
              fromState: current.state,
              toState: nextState,
              remindersSentCount: updated.remindersSentCount,
            }),
          },
        });
        return NextResponse.json({ schedule: updated });
      }

      // THE-103: Pause / Snooze Schedule
      case "PAUSE_SCHEDULE": {
        const pauseDays = Number(body.pauseDays) || 14;
        const reason = body.reason || "Travel / Temporary Pause";
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

      // THE-103: Trusted Verifier "User Is Alive" Signal (No Vault Access)
      case "TRUSTED_VERIFIER_ALIVE_SIGNAL": {
        const { contactId, attestationNote } = body;
        const contact = await prisma.contact.findUnique({
          where: { id: contactId },
        });
        if (!contact || contact.userId !== user.id) {
          throw new AuthorizationError("Contact not found.");
        }
        if (!contact.isTrustedVerifier || contact.status !== "VERIFIED") {
          throw new AuthorizationError(
            "Only verified Trusted Verifiers can signal that the user is alive. Recipient-only contacts are blocked."
          );
        }
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
            reason: `TRUSTED_CONTACT_ATTESTED_ALIVE:${contact.fullName}`,
            idempotencyKey: `alive_${current.id}_v${current.version}_${now.getTime()}`,
            actorType: "TRUSTED_CONTACT",
            actorId: contact.id,
          },
        });
        await prisma.releaseEvent.create({
          data: {
            scheduleId: current.id,
            userId: user.id,
            contactId: contact.id,
            eventType: "VERIFIER_ATTESTED_ALIVE",
            metadataJson: JSON.stringify({
              verifierName: contact.fullName,
              attestationNote,
            }),
          },
        });
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "TRUSTED_CONTACT_SIGNALED_ALIVE",
            severity: "WARN",
            actorType: "TRUSTED_CONTACT",
            actorId: contact.id,
            redactedMeta: JSON.stringify({
              contactId: contact.id,
              verifierName: contact.fullName,
              previousState: current.state,
            }),
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