// lib/db.ts
// The one database client for the app.
//
// It talks to Postgres (Neon) through a Prisma driver adapter, which works the same on Node and
// inside a Cloudflare Worker. In a Worker the connection string comes from the Hyperdrive binding
// when one is set, and from DATABASE_URL otherwise. See lib/db-provider.ts for the per-request rule.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createClientProvider } from "./db-provider";
import { lazyInstance } from "./lazy-instance";

const isCloudflareWorker =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

interface WorkerBindings {
  HYPERDRIVE?: { connectionString: string };
}

function currentRequestKey(): object | null {
  if (!isCloudflareWorker) return null;
  try {
    return getCloudflareContext().ctx;
  } catch {
    // Outside a request (for example while the app is being built) there is no connection to
    // protect, so the shared client is correct.
    return null;
  }
}

function connectionString(): string {
  if (isCloudflareWorker) {
    try {
      const hyperdrive = (getCloudflareContext().env as WorkerBindings).HYPERDRIVE;
      if (hyperdrive?.connectionString) return hyperdrive.connectionString;
    } catch {
      // No request context: fall through to DATABASE_URL.
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: connectionString(),
    // A Worker request may hold at most 6 outgoing connections at once.
    max: isCloudflareWorker ? 5 : 10,
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

const globalForPrisma = globalThis as unknown as {
  duskClientProvider: (() => PrismaClient) | undefined;
};

// Kept on globalThis so a development hot reload does not open a new pool every time.
const getClient =
  globalForPrisma.duskClientProvider ??
  createClientProvider({ create: createPrismaClient, requestKey: currentRequestKey });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.duskClientProvider = getClient;
}

export const prisma: PrismaClient = lazyInstance(getClient);
