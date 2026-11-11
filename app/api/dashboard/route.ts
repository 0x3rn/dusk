// app/api/dashboard/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { auth } from "@/lib/auth/server";
import { getFoundationService, requireUser } from "@/lib/auth/current-user";
import { errorToResponse } from "@/lib/api/errors";
import { assertSameOrigin } from "@/lib/api/csrf";
import { readJsonBody } from "@/lib/api/body";
import { parseDashboardAction } from "@/lib/api/dashboard-actions";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { consumeRateLimit } from "@/lib/security/db-rate-limiter";
import { createEngine } from "@/lib/engine/engine";
import { AuthorizationError } from "@/lib/services/foundation-service";
import { ValidationError } from "@/lib/auth/security";
import { redactForAuditLog } from "@/lib/domain/trust-boundary";
import { ContactService } from "@/lib/services/contact-service";
import { PrismaContactStore } from "@/lib/services/prisma-contact-store";
import {
  invitationIdempotencyKey,
  sendContactInvitationEmail,
  toDashboardContact,
} from "@/lib/services/contact-invitation-delivery";
import { upgradeVaultKdf } from "@/lib/services/vault-kdf-upgrade";
import { INVITE_TTL_DAYS } from "@/lib/domain/invitation-status";

export async function GET() {
  try {
    const { user, authSession } = await requireUser();

    const [
      vault,
      schedule,
      contacts,
      recoveryArtifacts,
      assignments,
      auditEvents,
      purchase,
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
      // Only the purchase date: no payment ids or customer data reach the browser.
      prisma.user.findUnique({
        where: { id: user.id },
        select: { lifetimePurchasedAt: true },
      }),
    ]);

    // Did the email for each waiting invitation go out? Looked up by the idempotency key of the
    // CURRENT link, so a resend starts clean. toDashboardContact drops the token hash
    // (a credential-at-rest the browser never needs).
    const waiting = contacts.filter((c) => c.status === "PENDING_INVITE" && c.inviteTokenHash);
    const deliveries = waiting.length
      ? await prisma.notificationDelivery.findMany({
          where: { userId: user.id, idempotencyKey: { in: waiting.map(invitationIdempotencyKey) } },
          select: { idempotencyKey: true, status: true },
        })
      : [];
    const deliveryStatusByKey = new Map(deliveries.map((d) => [d.idempotencyKey, d.status]));

    return NextResponse.json({
      user: { ...user, lifetimePurchasedAt: purchase?.lifetimePurchasedAt ?? null },
      currentSessionId: authSession.id,
      vault,
      schedule,
      contacts: contacts.map((c) => toDashboardContact(c, deliveryStatusByKey)),
      recoveryArtifacts,
      assignments,
      auditEvents,
    });
  } catch (err: unknown) {
    return errorToResponse(err, "GET /api/dashboard");
  }
}

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user } = await requireUser();
    await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.DASHBOARD_MUTATION, user.id);
    const service = getFoundationService();
    const engine = createEngine();
    const body = parseDashboardAction(await readJsonBody(req));

    switch (body.action) {
      case "LOGOUT": {
        await auth.signOut();
        await prisma.auditEvent.create({
          data: {
            userId: user.id,
            eventType: "AUTH_SIGNED_OUT",
            severity: "INFO",
            actorType: "USER",
            actorId: user.id,
            redactedMeta: "{}",
          },
        });
        return NextResponse.json({ ok: true });
      }

      case "INIT_VAULT": {
        const vault = await service.createEmptyVault(user.id, body.vaultBundle);
        let recoveryArtifact = null;
        if (body.recoveryServerArtifact) {
          const artifact = body.recoveryServerArtifact;
          await prisma.recoveryArtifact.updateMany({
            where: { userId: user.id, isActive: true },
            data: { isActive: false, revokedAt: new Date() },
          });
          recoveryArtifact = await prisma.recoveryArtifact.create({
            data: {
              userId: user.id,
              keyVersion: artifact.keyVersion,
              recoveryWrappedVmKBase64:
                artifact.recoveryWrappedVmKBase64,
              recoveryWrappedVmKIv:
                artifact.recoveryWrappedVmKIv,
              kdfSaltBase64: artifact.kdfSaltBase64,
              kdfAlgorithm: artifact.kdfAlgorithm,
              fingerprintHex: artifact.fingerprintHex,
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

      case "UPGRADE_VAULT_KDF": {
        // Same-origin, signed in and rate limited above. Ownership comes from the session, never
        // from the body; the swap only happens if the stored wrap is the one the browser saw.
        const upgraded = await upgradeVaultKdf(prisma, user.id, body);
        return NextResponse.json({ upgraded: true, kdfAlgorithm: upgraded.kdfAlgorithm });
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
        await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.INVITE_SEND, user.id);
        const contacts = new ContactService(new PrismaContactStore(prisma));

        // The person starts as "waiting for them to accept". Nobody is a verifier or a
        // beneficiary until they open the emailed link and accept. A beneficiary's public key
        // is still stored now (the owner's browser made the pair; the private half never reaches us).
        const { contact, rawInviteToken } = await contacts.inviteContact(user.id, {
          fullName: body.contact.fullName,
          email: body.contact.email,
          phone: body.contact.phone ?? undefined,
          isBeneficiary: body.contact.isBeneficiary,
          isTrustedVerifier: body.contact.isTrustedVerifier,
          publicKeyBase64: body.contact.publicKeyBase64,
        });

        // A failed send leaves the person waiting; the owner is told and can press Resend.
        const { delivered } = await sendContactInvitationEmail(engine.notifier, {
          ownerUserId: user.id,
          ownerName: user.fullName?.trim() || null,
          contact,
          rawToken: rawInviteToken,
          appUrl: engine.appUrl,
        });

        return NextResponse.json(
          {
            contact: toDashboardContact(contact, new Map([[invitationIdempotencyKey(contact), delivered ? "DELIVERED" : "FAILED"]])),
            invitation: { delivered, expiresInDays: INVITE_TTL_DAYS },
          },
          { status: 201 }
        );
      }

      case "RESEND_INVITE": {
        await consumeRateLimit(prisma, RATE_LIMIT_POLICIES.INVITE_SEND, user.id);
        const contacts = new ContactService(new PrismaContactStore(prisma));

        // A new token replaces the old one, so the link in the earlier email stops working.
        const { contact, rawInviteToken } = await contacts.reinviteContact(user.id, body.contactId);
        const { delivered } = await sendContactInvitationEmail(engine.notifier, {
          ownerUserId: user.id,
          ownerName: user.fullName?.trim() || null,
          contact,
          rawToken: rawInviteToken,
          appUrl: engine.appUrl,
        });

        return NextResponse.json({ invitation: { delivered, expiresInDays: INVITE_TTL_DAYS } });
      }

      case "CANCEL_INVITE": {
        const contacts = new ContactService(new PrismaContactStore(prisma));
        await contacts.cancelInvitation(user.id, body.contactId);
        return NextResponse.json({ ok: true });
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
        // Items can only be set aside for someone who has agreed to receive them.
        if (contact.status !== "VERIFIED") {
          throw new ValidationError(
            "This person has not accepted their invitation yet. You can give them items once they accept."
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
        // The browser sends a fresh key per click so a double-click is one check-in, not two.
        const idempotencyKey =
          body.idempotencyKey !== undefined && body.idempotencyKey.length >= 8
            ? `checkin_ui_${user.id}_${body.idempotencyKey.slice(0, 64)}`
            : undefined;
        const { schedule } = await engine.checkIn.recordAuthenticatedCheckIn(user.id, idempotencyKey);
        return NextResponse.json({ schedule });
      }

      case "UPDATE_SCHEDULE_CONFIG": {
        const current = await prisma.checkInSchedule.findUniqueOrThrow({
          where: { userId: user.id },
        });
        const intervalDays = body.intervalDays || current.intervalDays;
        const schedule = await engine.checkIn.updateScheduleConfiguration(user.id, {
          intervalDays,
          gracePeriodDays: body.gracePeriodDays || current.gracePeriodDays,
          // Keep the reminder window valid if the interval was shortened below it.
          reminderDaysBeforeDue: Math.min(current.reminderDaysBeforeDue, Math.max(1, intervalDays - 1)),
          minRequiredReminders: current.minRequiredReminders,
          requiredVerifierApprovals: current.requiredVerifierApprovals,
        });
        return NextResponse.json({ schedule });
      }

      case "PAUSE_SCHEDULE": {
        const { schedule } = await engine.escalation().pauseSchedule(user.id, {
          pauseDays: body.pauseDays || 14,
          reason: body.reason && body.reason.length >= 3 ? body.reason : "Paused by owner",
        });
        return NextResponse.json({ schedule });
      }

      case "CANCEL_FALSE_TRIGGER": {
        const { schedule } = await engine.escalation().cancelFalseTrigger(user.id, {
          reason: body.reason && body.reason.length >= 3 ? body.reason : undefined,
        });
        return NextResponse.json({ schedule });
      }
    }
  } catch (err: unknown) {
    return errorToResponse(err, "POST /api/dashboard");
  }
}
