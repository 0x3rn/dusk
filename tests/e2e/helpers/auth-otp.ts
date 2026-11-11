// tests/e2e/helpers/auth-otp.ts
// Reads the emailed one-time code from the DEV database so a browser test can finish a password
// reset without opening a mailbox. Importing the integration helpers first means this file refuses
// to run when DATABASE_URL points at the production branch, exactly like the integration tests.
import { db } from "../../integration/helpers";
import { parseStoredOtp, resetOtpIdentifier } from "../../helpers/otp-hash";

/** Polls briefly, because the code is written a moment after the page says it was sent. */
export async function readResetOtp(email: string, timeoutMs = 15_000): Promise<string> {
  const identifier = resetOtpIdentifier(email);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.$queryRaw<{ value: string }[]>`
      select "value" from neon_auth.verification
      where "identifier" = ${identifier} and "expiresAt" > now()
      order by "createdAt" desc
      limit 1`;
    if (rows.length > 0) return parseStoredOtp(rows[0].value);
    if (Date.now() > deadline) throw new Error(`No reset code appeared for ${identifier} within ${timeoutMs}ms.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export async function closeOtpDb(): Promise<void> {
  await db.$disconnect();
}
