// tests/integration/helpers.ts
import "./load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace("-pooler", "");
  } catch {
    return null;
  }
}

/** The production URL lives in .env; .env.local must override it with the dev branch. */
function productionHost(): string | null {
  try {
    const raw = readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const match = raw.match(/^DATABASE_URL=["']?([^"'\r\n]+)/m);
    return hostOf(match?.[1]);
  } catch {
    return null;
  }
}

const target = hostOf(process.env.DATABASE_URL);
if (!target) {
  throw new Error("Integration tests need DATABASE_URL (set the dev branch in .env.local).");
}
if (target === productionHost()) {
  throw new Error(
    "Refusing to run integration tests: DATABASE_URL points at the production branch. " +
      "Put the Neon dev branch connection string in .env.local."
  );
}

export const db = new PrismaClient();

/** Creates a throwaway user + default schedule. Rows are removed by cleanupUser. */
export async function createTestUser(label: string) {
  const tag = `itest_${label}_${randomUUID().slice(0, 8)}`;
  const user = await db.user.create({
    data: { authUserId: `auth_${tag}`, email: `${tag}@example.test`, fullName: tag },
  });
  const now = new Date();
  const schedule = await db.checkInSchedule.create({
    data: {
      userId: user.id,
      state: "HEALTHY",
      intervalDays: 90,
      gracePeriodDays: 14,
      lastCheckInAt: now,
      nextDueAt: new Date(now.getTime() + 90 * 86_400_000),
    },
  });
  return { user, schedule };
}

/** Deletes everything a test user owns. User deletes cascade to schedules, events, contacts, etc. */
export async function cleanupUser(userId: string) {
  await db.user.delete({ where: { id: userId } }).catch(() => undefined);
}
