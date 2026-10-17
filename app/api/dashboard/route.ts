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

    const [vault, schedule, contacts, recoveryArtifacts, assignments, auditEvents] =
      await Promise.all([
        prisma.vault.findUnique({
          where: { userId: user.id },
          include: {
            items: { orderBy: { createdAt: "desc" } },
          },
        }),
        prisma.checkInSchedule.findUnique({ where: { userId: user.id } }),
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
          take: 15,
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
    return NextResponse.json({ error: "Failed to load dashboard state." }, { status: 500 });
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
              recoveryWrappedVmKIv: body.recoveryServerArtifact.recoveryWrappedVmKIv,
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
        const { fullName, email, phone, isBeneficiary, isTrustedVerifier, publicKeyBase64 } =
          body.contact;
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
    if (err instanceof ValidationError || err instanceof TrustBoundaryViolationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[POST /api/dashboard]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Operation failed" },
      { status: 500 }
    );
  }
}