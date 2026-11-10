// lib/billing/prisma-billing-store.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import type { BillingStore } from "./lifetime-access";

export class PrismaBillingStore implements BillingStore {
  constructor(private readonly db: PrismaClient) {}

  async userExists(userId: string): Promise<boolean> {
    const found = await this.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    return found !== null;
  }

  async grantLifetimeAccessOnce(input: {
    eventId: string;
    eventType: string;
    userId: string;
    stripeCustomerId: string | null;
    now: Date;
  }): Promise<"granted" | "duplicate"> {
    try {
      await this.db.$transaction(async (tx) => {
        // The primary key on StripeEvent.id is the idempotency guard: a replayed webhook
        // fails here and rolls the whole transaction back, so nothing is granted twice.
        await tx.stripeEvent.create({
          data: { id: input.eventId, type: input.eventType, userId: input.userId },
        });
        await tx.user.update({
          where: { id: input.userId },
          data: {
            hasLifetimeAccess: true,
            lifetimePurchasedAt: input.now,
            ...(input.stripeCustomerId ? { stripeCustomerId: input.stripeCustomerId } : {}),
          },
        });
        await tx.auditEvent.create({
          data: {
            userId: input.userId,
            eventType: "LIFETIME_ACCESS_GRANTED",
            severity: "INFO",
            actorType: "SYSTEM",
            redactedMeta: JSON.stringify({ stripeEventId: input.eventId }),
          },
        });
      });
      return "granted";
    } catch (err) {
      // Only a clash on the event ledger means "already handled". A clash elsewhere (for
      // example stripeCustomerId already owned by another user) must surface, not hide a payment.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002" &&
        err.meta?.modelName === "StripeEvent"
      ) {
        return "duplicate";
      }
      throw err;
    }
  }
}
