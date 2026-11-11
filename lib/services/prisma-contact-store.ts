// lib/services/prisma-contact-store.ts
// PostgreSQL implementation of ContactPersistencePort. Every state change that two requests
// could race on (accept, decline, resend) is one conditional UPDATE: the check and the change
// happen together in the database, so exactly one request wins.
import { Prisma, type PrismaClient } from "@prisma/client";
import { ValidationError } from "../auth/security";
import type {
  ContactAuditEntry,
  ContactPersistencePort,
  ContactRecord,
} from "./contact-service";

type CreateData = Parameters<ContactPersistencePort["createContact"]>[0];
type UpdateData = Parameters<ContactPersistencePort["updateContact"]>[1];

export class PrismaContactStore implements ContactPersistencePort {
  constructor(private readonly db: PrismaClient) {}

  findContactById(contactId: string): Promise<ContactRecord | null> {
    return this.db.contact.findUnique({ where: { id: contactId } });
  }

  findContactByUserAndEmail(userId: string, email: string): Promise<ContactRecord | null> {
    return this.db.contact.findUnique({ where: { userId_email: { userId, email } } });
  }

  findContactByInviteTokenHash(tokenHash: string): Promise<ContactRecord | null> {
    return this.db.contact.findUnique({ where: { inviteTokenHash: tokenHash } });
  }

  listContactsByUserId(userId: string): Promise<ContactRecord[]> {
    return this.db.contact.findMany({ where: { userId } });
  }

  countReleaseAssignmentsForContact(contactId: string): Promise<number> {
    return this.db.releaseAssignment.count({ where: { contactId } });
  }

  async deleteReleaseAssignmentsForContact(contactId: string): Promise<number> {
    const result = await this.db.releaseAssignment.deleteMany({ where: { contactId } });
    return result.count;
  }

  async findOwnerDisplayName(userId: string): Promise<string | null> {
    const owner = await this.db.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    const name = owner?.fullName?.trim();
    return name ? name : null;
  }

  async createContact(data: CreateData): Promise<ContactRecord> {
    try {
      return await this.db.contact.create({ data });
    } catch (err) {
      // Two "add" requests for the same email at once: the unique index lets only one through.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ValidationError("A contact with this email already exists.");
      }
      throw err;
    }
  }

  updateContact(contactId: string, data: UpdateData): Promise<ContactRecord> {
    return this.db.contact.update({ where: { id: contactId }, data });
  }

  async deleteContact(contactId: string): Promise<void> {
    await this.db.contact.delete({ where: { id: contactId } });
  }

  async acceptPendingInvite(args: {
    tokenHash: string;
    now: Date;
    publicKeyBase64: string | null;
    keyAlgorithm: string | null;
  }): Promise<ContactRecord | null> {
    return this.transitionByToken(args.tokenHash, { gt: args.now }, {
      status: "VERIFIED",
      inviteTokenHash: null,
      inviteExpiresAt: null, // consumed: the link cannot be replayed
      verifiedAt: args.now,
      publicKeyBase64: args.publicKeyBase64,
      keyAlgorithm: args.keyAlgorithm,
    });
  }

  async declinePendingInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null> {
    return this.transitionByToken(args.tokenHash, { gt: args.now }, {
      status: "DECLINED",
      inviteTokenHash: null,
      inviteExpiresAt: null,
      verifiedAt: null,
      publicKeyBase64: null,
    });
  }

  async clearExpiredInvite(args: { tokenHash: string; now: Date }): Promise<ContactRecord | null> {
    // Keeps inviteExpiresAt (in the past) so the owner sees "Invitation expired".
    return this.transitionByToken(args.tokenHash, { lte: args.now }, { inviteTokenHash: null });
  }

  async reissuePendingInvite(args: {
    contactId: string;
    userId: string;
    tokenHash: string;
    inviteExpiresAt: Date;
  }): Promise<ContactRecord | null> {
    const result = await this.db.contact.updateMany({
      where: { id: args.contactId, userId: args.userId, status: "PENDING_INVITE" },
      data: { inviteTokenHash: args.tokenHash, inviteExpiresAt: args.inviteExpiresAt },
    });
    if (result.count !== 1) return null;
    return this.db.contact.findUnique({ where: { id: args.contactId } });
  }

  async appendAuditEvent(data: ContactAuditEntry): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        userId: data.userId,
        eventType: data.eventType,
        severity: data.severity,
        actorType: data.actorType ?? "USER",
        actorId: data.actorId === undefined ? data.userId : data.actorId,
        redactedMeta: data.redactedMeta,
      },
    });
  }

  /** One conditional UPDATE keyed by the token hash; null when it matched nothing. */
  private async transitionByToken(
    tokenHash: string,
    expiresAt: { gt: Date } | { lte: Date },
    data: Prisma.ContactUpdateManyMutationInput
  ): Promise<ContactRecord | null> {
    const target = await this.db.contact.findUnique({
      where: { inviteTokenHash: tokenHash },
      select: { id: true },
    });
    if (!target) return null;
    const result = await this.db.contact.updateMany({
      where: {
        id: target.id,
        inviteTokenHash: tokenHash,
        status: "PENDING_INVITE",
        inviteExpiresAt: expiresAt,
      },
      data,
    });
    if (result.count !== 1) return null;
    return this.db.contact.findUnique({ where: { id: target.id } });
  }
}
