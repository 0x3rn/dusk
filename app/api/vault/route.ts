// app/api/vault/route.ts
import { NextResponse } from "next/server";
import { getFoundationService, requireUser } from "@/lib/auth/current-user";
import { errorToResponse } from "@/lib/api/errors";

export async function POST(req: Request) {
  try {
    const { user } = await requireUser();
    const body = await req.json();
    const vault = await getFoundationService().createEmptyVault(user.id, body);

    return NextResponse.json({ vault }, { status: 201 });
  } catch (err: unknown) {
    return errorToResponse(err, "POST /api/vault");
  }
}
