// lib/auth/neon-security-store.ts
// Security Center backed by Neon Auth: devices are the user's real Neon Auth sessions, and
// revoking one really ends it. Built per request, because Neon Auth identifies the caller from
// their cookie. Session tokens never leave the server: the browser only ever sees session ids.
import { hashIpAddress } from "./security";
import { auth } from "./server";
import type { PrismaClient } from "@prisma/client";
import type { SessionRecord } from "../services/foundation-service";
import type { SecurityCenterPersistencePort } from "../services/security-center-service";

/** A readable device label from a User-Agent string, e.g. "Chrome on Windows". */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\/|Opera/.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : /curl\//i.test(userAgent)
              ? "Command line"
              : "Browser";
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /iPhone|iPad|iOS/.test(userAgent)
      ? "iOS"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X|Macintosh/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return os ? `${browser} on ${os}` : browser;
}

interface NeonSession {
  id: string;
  userId: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function listNeonSessions(): Promise<NeonSession[]> {
  const result = await auth.listSessions();
  if ("error" in result && result.error) {
    throw new Error("Could not list sessions.");
  }
  return ("data" in result && Array.isArray(result.data) ? result.data : []) as NeonSession[];
}

function toRecord(s: NeonSession, duskUserId: string): SessionRecord {
  return {
    id: s.id,
    userId: duskUserId,
    deviceName: describeDevice(s.userAgent),
    userAgent: s.userAgent ?? null,
    ipAddressHash: s.ipAddress ? hashIpAddress(s.ipAddress) : null,
    lastActiveAt: new Date(s.updatedAt),
    expiresAt: new Date(s.expiresAt),
    revokedAt: null,
  };
}

export function createNeonSecurityCenterStore(
  db: PrismaClient,
  dusk: { userId: string }
): SecurityCenterPersistencePort {
  return {
    async findUserById(userId) {
      return db.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          authUserId: true,
          email: true,
          fullName: true,
          hasLifetimeAccess: true,
          createdAt: true,
          mfaEnabled: true,
        },
      });
    },

    async updateUserMfaState(userId, data) {
      await db.user.update({ where: { id: userId }, data });
    },

    async listSessionsByUserId() {
      // Neon Auth only lists the signed-in caller's own sessions, which is exactly the scope we want.
      return (await listNeonSessions()).map((s) => toRecord(s, dusk.userId));
    },

    async findSessionById(sessionId) {
      const found = (await listNeonSessions()).find((s) => s.id === sessionId);
      return found ? toRecord(found, dusk.userId) : null;
    },

    async revokeSessionById(sessionId, revokedAt) {
      const target = (await listNeonSessions()).find((s) => s.id === sessionId);
      if (!target) throw new Error("Session not found.");
      const result = await auth.revokeSession({ token: target.token });
      if ("error" in result && result.error) throw new Error("Could not revoke the session.");
      return { ...toRecord(target, dusk.userId), revokedAt };
    },

    async revokeAllOtherSessions(_userId, keepSessionId) {
      const others = (await listNeonSessions()).filter((s) => s.id !== keepSessionId);
      if (others.length === 0) return 0;
      const result = await auth.revokeOtherSessions();
      if ("error" in result && result.error) throw new Error("Could not revoke other sessions.");
      return others.length;
    },

    async listActiveRecoveryArtifacts(userId) {
      return db.recoveryArtifact.findMany({
        where: { userId, isActive: true },
        orderBy: { createdAt: "desc" },
      });
    },

    countVerifiedBeneficiaries: (userId) =>
      db.contact.count({ where: { userId, isBeneficiary: true, status: "VERIFIED" } }),

    countVerifiedTrustedVerifiers: (userId) =>
      db.contact.count({ where: { userId, isTrustedVerifier: true, status: "VERIFIED" } }),

    async getScheduleState(userId) {
      const s = await db.checkInSchedule.findUnique({
        where: { userId },
        select: { state: true, remindersSentCount: true },
      });
      return s;
    },

    listRecentAuditEvents: (userId, limit) =>
      db.auditEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          userId: true,
          eventType: true,
          severity: true,
          redactedMeta: true,
          createdAt: true,
        },
      }),

    async appendAuditEvent(data) {
      await db.auditEvent.create({
        data: { ...data, actorType: "USER", actorId: data.userId },
      });
    },
  };
}
