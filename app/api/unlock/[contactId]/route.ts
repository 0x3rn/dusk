// app/api/unlock/[contactId]/route.ts
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import { hashOpaqueToken } from "@/lib/auth/security";
import { redactForAuditLog } from "@/lib/domain/trust-boundary";

export async function POST(
  req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  try {
    const { contactId } = await context.params;
    const body = await req.json();

    if (body.action === "ACKNOWLEDGE_RECEIPT") {
      const { grantEventId, beneficiaryEmail, decryptedCount } = body;
      const contact = await prisma.contact.findUnique({ where: { id: contactId } });
      if (
        !contact ||
        contact.email.toLowerCase() !== (beneficiaryEmail || "").trim().toLowerCase()
      ) {
        return NextResponse.json({ error: "Unauthorized beneficiary." }, { status: 403 });
      }
      const schedule = await prisma.checkInSchedule.findUniqueOrThrow({
        where: { userId: contact.userId },
      });

      const ack = await prisma.releaseEvent.create({
        data: {
          scheduleId: schedule.id,
          userId: contact.userId,
          contactId: contact.id,
          eventType: "PACKAGE_RECEIPT_ACKNOWLEDGED",
          metadataJson: JSON.stringify({
            grantEventId,
            decryptedItemCountConfirmed: decryptedCount,
            acknowledgedAtIso: new Date().toISOString(),
          }),
        },
      });

      await prisma.auditEvent.create({
        data: {
          userId: contact.userId,
          eventType: "BENEFICIARY_PACKAGE_ACKNOWLEDGED",
          severity: "INFO",
          actorType: "BENEFICIARY",
          actorId: contact.id,
          redactedMeta: JSON.stringify({
            contactId: contact.id,
            grantEventId,
            decryptedItemCountConfirmed: decryptedCount,
          }),
        },
      });

      return NextResponse.json({ ok: true, ackId: ack.id });
    }

    // Default action: RETRIEVE_PACKAGE
    const { rawAccessToken, beneficiaryEmail } = body;
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      return NextResponse.json(
        { error: "Beneficiary contact not found." },
        { status: 404 }
      );
    }

    const schedule = await prisma.checkInSchedule.findUnique({
      where: { userId: contact.userId },
    });

    if (!schedule || schedule.state !== "RELEASED") {
      if (schedule) {
        await prisma.releaseEvent.create({
          data: {
            scheduleId: schedule.id,
            userId: contact.userId,
            contactId: contact.id,
            eventType: "PACKAGE_ACCESS_DENIED",
            metadataJson: JSON.stringify({ reason: "ESTATE_NOT_RELEASED" }),
          },
        });
      }
      return NextResponse.json(
        {
          error: `This vault is currently locked (State: ${
            schedule?.state || "HEALTHY"
          }). Estate release has not been authorized.`,
        },
        { status: 403 }
      );
    }

    if (
      contact.email.toLowerCase() !==
      (beneficiaryEmail || "").trim().toLowerCase()
    ) {
      await prisma.releaseEvent.create({
        data: {
          scheduleId: schedule.id,
          userId: contact.userId,
          contactId: contact.id,
          eventType: "PACKAGE_ACCESS_DENIED",
          metadataJson: JSON.stringify({ reason: "EMAIL_MISMATCH" }),
        },
      });
      return NextResponse.json(
        { error: "Authenticated email does not match the designated beneficiary." },
        { status: 403 }
      );
    }

    const tokenHash = hashOpaqueToken(rawAccessToken || "");
    const grant = await prisma.releaseEvent.findUnique({
      where: { actionTokenHash: tokenHash },
    });

    if (
      !grant ||
      grant.eventType !== "BENEFICIARY_ACCESS_GRANT_ISSUED" ||
      grant.contactId !== contact.id
    ) {
      return NextResponse.json(
        { error: "Invalid or unauthorized release access grant token." },
        { status: 403 }
      );
    }

    if (grant.tokenUsedAt !== null) {
      return NextResponse.json(
        {
          error:
            "Replay blocked: This single-use release access token has already been used.",
        },
        { status: 403 }
      );
    }

    if (!grant.tokenExpiresAt || grant.tokenExpiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "This release access grant token has expired." },
        { status: 403 }
      );
    }

    // Consume the single-use grant token
    await prisma.releaseEvent.update({
      where: { id: grant.id },
      data: { tokenUsedAt: new Date() },
    });

    // Fetch ONLY the items assigned to this beneficiary
    const assignments = await prisma.releaseAssignment.findMany({
      where: { contactId: contact.id },
      include: { item: true },
    });

    const scopedItems = assignments
      .filter((a) => a.item && a.item.keyVersion === a.keyVersion)
      .map((a) => ({
        itemId: a.item!.id,
        vaultId: a.item!.vaultId,
        category: a.item!.category,
        schemaVersion: a.item!.schemaVersion,
        keyVersion: a.item!.keyVersion,
        ciphertextBase64: a.item!.ciphertextBase64,
        ivBase64: a.item!.ivBase64,
        aadResourceId: a.item!.aadResourceId,
        wrappedGrant: {
          schemaVersion: 1,
          keyVersion: a.keyVersion,
          vaultId: a.item!.vaultId,
          contactId: contact.id,
          itemId: a.item!.aadResourceId,
          beneficiaryWrappedKeyBase64: a.beneficiaryWrappedKeyBase64,
          beneficiaryWrappedKeyIv: a.beneficiaryWrappedKeyIv,
          ephemeralPublicKeyBase64: a.ephemeralPublicKeyBase64,
          algorithm: "ECDH-P256-HKDF-AES256GCM",
        },
      }));

    const manifestSha256Hex = crypto
      .createHash("sha256")
      .update(JSON.stringify(scopedItems), "utf8")
      .digest("hex");

    await prisma.releaseEvent.create({
      data: {
        scheduleId: schedule.id,
        userId: contact.userId,
        contactId: contact.id,
        eventType: "PACKAGE_ACCESS_SUCCEEDED",
        metadataJson: JSON.stringify({
          grantEventId: grant.id,
          itemCount: scopedItems.length,
          manifestSha256Hex,
        }),
      },
    });

    await prisma.auditEvent.create({
      data: {
        userId: contact.userId,
        eventType: "BENEFICIARY_PACKAGE_DELIVERED",
        severity: "CRITICAL",
        actorType: "BENEFICIARY",
        actorId: contact.id,
        redactedMeta: JSON.stringify(
          redactForAuditLog({
            contactId: contact.id,
            grantEventId: grant.id,
            itemCount: scopedItems.length,
            manifestSha256Hex,
          })
        ),
      },
    });

    return NextResponse.json({
      grantEventId: grant.id,
      beneficiaryName: contact.fullName,
      beneficiaryEmail: contact.email,
      manifestSha256Hex,
      items: scopedItems,
    });
  } catch (err: unknown) {
    console.error("[POST /api/unlock/[contactId]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to retrieve package." },
      { status: 500 }
    );
  }
}