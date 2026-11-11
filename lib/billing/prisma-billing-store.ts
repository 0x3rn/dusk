// lib/billing/prisma-billing-store.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import type { BillingStore } from "./lifetime-access";

const PROVIDER = "lemonsqueezy";

/** Marks "the ledger key was already recorded" so the surrounding transaction rolls back. */
function isLedgerClash(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    err.meta?.modelName === "PaymentEvent"
  );
}

export class PrismaBillingStore implements BillingStore {
  constructor(private readonly db: PrismaClient) {}

  async userExists(userId: string): Promise<boolean> {
    const found = await this.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    return found !== null;
  }

  async grantLifetimeAccessOnce(input: {
    eventKey: string;
    orderId: string;
    userId: string;
    customerId: string | null;
    testMode: boolean;
    now: Date;
  }): Promise<"granted" | "duplicate" | "already_refunded"> {
    try {
      return await this.db.$transaction(async (tx) => {
        // A full refund for this order may have been delivered before its creation event.
        const fullyRefunded =
          (await tx.paymentEvent.count({
            where: { orderId: input.orderId, eventName: "order_refunded", outcome: "REFUNDED" },
          })) > 0;

        // The primary key on PaymentEvent.id is the idempotency guard: a replayed webhook fails
        // here (even when two deliveries run at the same moment) and the whole transaction rolls
        // back, so nothing is granted twice.
        await tx.paymentEvent.create({
          data: {
            id: input.eventKey,
            provider: PROVIDER,
            eventName: "order_created",
            orderId: input.orderId,
            userId: input.userId,
            outcome: fullyRefunded ? "SKIPPED_REFUNDED" : "GRANTED",
          },
        });
        if (fullyRefunded) return "already_refunded" as const;

        await tx.user.update({
          where: { id: input.userId },
          data: {
            hasLifetimeAccess: true,
            lifetimePurchasedAt: input.now,
            ...(input.customerId ? { lemonSqueezyCustomerId: input.customerId } : {}),
          },
        });
        await tx.auditEvent.create({
          data: {
            userId: input.userId,
            eventType: "LIFETIME_ACCESS_GRANTED",
            severity: "INFO",
            actorType: "SYSTEM",
            redactedMeta: JSON.stringify({ orderId: input.orderId, testMode: input.testMode }),
          },
        });
        return "granted" as const;
      });
    } catch (err) {
      // Only a clash on the ledger means "already handled". Any other failure must surface so
      // Lemon Squeezy retries instead of a payment being silently lost.
      if (isLedgerClash(err)) return "duplicate";
      throw err;
    }
  }

  async recordRefundOnce(input: {
    eventKey: string;
    orderId: string;
    userId: string;
    fullRefund: boolean;
    now: Date;
  }): Promise<"revoked" | "kept" | "partial" | "duplicate"> {
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.paymentEvent.create({
          data: {
            id: input.eventKey,
            provider: PROVIDER,
            eventName: "order_refunded",
            orderId: input.orderId,
            userId: input.userId,
            outcome: input.fullRefund ? "REFUNDED" : "PARTIAL_REFUND",
          },
        });

        if (!input.fullRefund) {
          // Part of the money came back, but the buyer still paid for the product: keep access.
          await tx.auditEvent.create({
            data: {
              userId: input.userId,
              eventType: "LIFETIME_ACCESS_PARTIAL_REFUND",
              severity: "WARN",
              actorType: "SYSTEM",
              redactedMeta: JSON.stringify({ orderId: input.orderId }),
            },
          });
          return "partial" as const;
        }

        // Access stays if the user still has another paid order that was not refunded.
        const otherGrants = await tx.paymentEvent.findMany({
          where: {
            userId: input.userId,
            eventName: "order_created",
            outcome: "GRANTED",
            orderId: { not: input.orderId },
          },
          select: { orderId: true },
        });
        let hasOtherPaidOrder = false;
        if (otherGrants.length > 0) {
          const refunded = await tx.paymentEvent.findMany({
            where: {
              orderId: { in: otherGrants.map((g) => g.orderId) },
              eventName: "order_refunded",
              outcome: "REFUNDED",
            },
            select: { orderId: true },
          });
          const refundedIds = new Set(refunded.map((r) => r.orderId));
          hasOtherPaidOrder = otherGrants.some((g) => !refundedIds.has(g.orderId));
        }

        if (!hasOtherPaidOrder) {
          // lifetimePurchasedAt is kept as history; hasLifetimeAccess is what the app checks.
          await tx.user.update({ where: { id: input.userId }, data: { hasLifetimeAccess: false } });
        }
        await tx.auditEvent.create({
          data: {
            userId: input.userId,
            eventType: "LIFETIME_ACCESS_REVOKED",
            severity: "CRITICAL",
            actorType: "SYSTEM",
            redactedMeta: JSON.stringify({ orderId: input.orderId, accessKept: hasOtherPaidOrder }),
          },
        });
        return hasOtherPaidOrder ? ("kept" as const) : ("revoked" as const);
      });
    } catch (err) {
      if (isLedgerClash(err)) return "duplicate";
      throw err;
    }
  }
}
