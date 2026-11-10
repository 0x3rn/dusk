// app/api/unlock/[contactId]/route.ts
// Beneficiary package retrieval and receipt acknowledgement. All rules (estate must be RELEASED,
// contact eligible, email matches, token valid / unused / unexpired / unrevoked, single-use
// consumed atomically, only assigned items returned) live in ReleaseDeliveryService.
import { NextResponse } from "next/server";
import { errorToResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { createEngine } from "@/lib/engine/engine";
import { ValidationError } from "@/lib/auth/security";
import { RATE_LIMIT_POLICIES } from "@/lib/security/http-hardening";
import { clientKeyFromRequest, consumeRateLimit } from "@/lib/security/db-rate-limiter";

export async function POST(
  req: Request,
  context: { params: Promise<{ contactId: string }> }
) {
  try {
    const { contactId } = await context.params;
    // Per caller AND per beneficiary, so guessing tokens for one contact is slow from anywhere.
    await consumeRateLimit(
      prisma,
      RATE_LIMIT_POLICIES.BENEFICIARY_PACKAGE_ACCESS,
      `${clientKeyFromRequest(req)}:${contactId}`
    );

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ValidationError("Invalid request.");
    }
    const engine = createEngine();

    if (body.action === "ACKNOWLEDGE_RECEIPT") {
      const ack = await engine.delivery.acknowledgePackageReceipt({
        contactId,
        grantEventId: body.grantEventId,
        authenticatedBeneficiaryEmail: body.beneficiaryEmail,
        decryptedItemCountConfirmed: body.decryptedCount,
      });
      return NextResponse.json({ ok: true, ackId: ack.id });
    }

    const { grantEventId, scopedPackage, downloadableBundle } =
      await engine.delivery.retrieveScopedPackageForBeneficiary({
        contactId,
        rawAccessToken: body.rawAccessToken,
        authenticatedBeneficiaryEmail: body.beneficiaryEmail,
      });

    // The browser needs each item's vault id to rebuild the encryption context it was wrapped under.
    const vaultIds = await prisma.encryptedItem.findMany({
      where: { id: { in: scopedPackage.items.map((i) => i.itemId) } },
      select: { id: true, vaultId: true },
    });
    const vaultIdByItem = new Map(vaultIds.map((v) => [v.id, v.vaultId]));

    const contact = await prisma.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: { fullName: true, email: true },
    });

    const items = scopedPackage.items.map((item) => {
      const vaultId = vaultIdByItem.get(item.itemId) ?? "";
      return {
        itemId: item.itemId,
        vaultId,
        category: item.category,
        schemaVersion: item.schemaVersion,
        keyVersion: item.keyVersion,
        ciphertextBase64: item.ciphertextBase64,
        ivBase64: item.ivBase64,
        aadResourceId: item.aadResourceId,
        wrappedGrant: {
          schemaVersion: 1,
          keyVersion: item.wrappedGrant.keyVersion,
          vaultId,
          contactId,
          itemId: item.aadResourceId,
          beneficiaryWrappedKeyBase64: item.wrappedGrant.beneficiaryWrappedKeyBase64,
          beneficiaryWrappedKeyIv: item.wrappedGrant.beneficiaryWrappedKeyIv,
          ephemeralPublicKeyBase64: item.wrappedGrant.ephemeralPublicKeyBase64,
          algorithm: "ECDH-P256-HKDF-AES256GCM",
        },
      };
    });

    return NextResponse.json({
      grantEventId,
      beneficiaryName: contact.fullName,
      beneficiaryEmail: contact.email,
      manifestSha256Hex: downloadableBundle.manifestSha256Hex,
      items,
    });
  } catch (err: unknown) {
    return errorToResponse(err, "POST /api/unlock/[contactId]");
  }
}
