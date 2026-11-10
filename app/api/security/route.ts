// app/api/security/route.ts
// Security Center: posture checklist, signed-in devices, and revoking devices.
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorToResponse } from "@/lib/api/errors";
import { assertSameOrigin } from "@/lib/api/csrf";
import { requireUser } from "@/lib/auth/current-user";
import { createNeonSecurityCenterStore } from "@/lib/auth/neon-security-store";
import { ValidationError } from "@/lib/auth/security";
import { prisma } from "@/lib/db";
import { SecurityCenterService } from "@/lib/services/security-center-service";

export const dynamic = "force-dynamic";

function serviceFor(userId: string) {
  return new SecurityCenterService(createNeonSecurityCenterStore(prisma, { userId }));
}

export async function GET() {
  try {
    const { user, authSession } = await requireUser();
    const overview = await serviceFor(user.id).getSecurityCenterOverview(user.id, authSession.id);
    return NextResponse.json({ overview });
  } catch (err) {
    return errorToResponse(err, "GET /api/security");
  }
}

const ActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("REVOKE_SESSION"), sessionId: z.string().min(1).max(200) }),
  z.object({ action: z.literal("REVOKE_OTHER_SESSIONS") }),
]);

export async function POST(req: Request) {
  try {
    assertSameOrigin(req);
    const { user, authSession } = await requireUser();
    const parsed = ActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ValidationError("Unknown security action.");

    const service = serviceFor(user.id);
    if (parsed.data.action === "REVOKE_SESSION") {
      if (parsed.data.sessionId === authSession.id) {
        throw new ValidationError("Use Sign out to end this device's session.");
      }
      await service.revokeDeviceSession(user.id, parsed.data.sessionId);
      return NextResponse.json({ ok: true });
    }
    const { revokedCount } = await service.revokeAllOtherDeviceSessions(user.id, authSession.id);
    return NextResponse.json({ ok: true, revokedCount });
  } catch (err) {
    return errorToResponse(err, "POST /api/security");
  }
}
