// app/api/invite/accept/route.ts
// "Accept" on the public invitation page. Authenticated by the single-use link token alone.
import { answerInvitation } from "@/lib/api/invite-answer";

export async function POST(req: Request) {
  return answerInvitation(req, "accept", "POST /api/invite/accept");
}
