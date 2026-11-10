// lib/services/prisma-readiness-store.ts
import type { PrismaClient } from "@prisma/client";
import type { ReadinessSimulationPersistencePort } from "./readiness-simulation-service";

/** Read-only view of an owner's estate for the release simulation (it never changes anything). */
export function createPrismaReadinessStore(db: PrismaClient): ReadinessSimulationPersistencePort {
  return {
    findVaultByUserId: (userId) => db.vault.findUnique({ where: { userId } }),
    findScheduleByUserId: (userId) => db.checkInSchedule.findUnique({ where: { userId } }),
    listItemsByUserId: (userId) => db.encryptedItem.findMany({ where: { userId } }),
    listFilesByUserId: (userId) => db.encryptedFile.findMany({ where: { userId } }),
    listContactsByUserId: (userId) => db.contact.findMany({ where: { userId } }),
    async listAssignmentsByUserId(userId) {
      const rows = await db.releaseAssignment.findMany({ where: { userId } });
      return rows.flatMap((r) => (r.itemId ? [{ ...r, itemId: r.itemId }] : []));
    },
    listActiveRecoveryArtifactsByUserId: (userId) =>
      db.recoveryArtifact.findMany({ where: { userId, isActive: true } }),
    async appendAuditEvent(data) {
      await db.auditEvent.create({ data: { ...data, actorType: "USER", actorId: data.userId } });
    },
  };
}
