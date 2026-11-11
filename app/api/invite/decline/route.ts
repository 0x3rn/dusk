// app/api/invite/decline/route.ts
// "Decline" on the public invitation page. Authenticated by the single-use link token alone.
import { answerInvitation } from "@/lib/api/invite-answer";

export async function POST(req: Request) {
  return answerInvitation(req, "decline", "POST /api/invite/decline");
}
