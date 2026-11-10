// app/api/readiness/route.ts
// "Will my plan actually work?" A dry run: checks vault, contacts, assignments and recovery,
// and simulates a release without changing or sending anything.
import { NextResponse } from "next/server";
import { errorToResponse } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { createPrismaReadinessStore } from "@/lib/services/prisma-readiness-store";
import { ReadinessSimulationService } from "@/lib/services/readiness-simulation-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await requireUser();
    const report = await new ReadinessSimulationService(
      createPrismaReadinessStore(prisma)
    ).runReleaseSimulationAndReadinessCheck(user.id);
    return NextResponse.json({ report });
  } catch (err) {
    return errorToResponse(err, "GET /api/readiness");
  }
}
