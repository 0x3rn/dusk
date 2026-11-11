// tests/integration/invites.int.test.ts
// The invitation flow against Postgres (the Neon dev branch), through the real service, the real
// Prisma store and the real public route handlers: invite -> email link -> accept, plus the attacks
// that must fail (replay, expired link, simultaneous clicks, an old link after a resend) and the
// rule that a person who has not accepted is invisible to the release engine.
import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTestUser, db } from "./helpers";
import { createEngine } from "@/lib/engine/engine";
import { runSchedulerSweep } from "@/lib/engine/sweep";
import { ContactService } from "@/lib/services/contact-service";
import { PrismaContactStore } from "@/lib/services/prisma-contact-store";
import { sendContactInvitationEmail } from "@/lib/services/contact-invitation-delivery";
import { INVITE_TTL_MS } from "@/lib/domain/invitation-status";
import { POST as acceptPOST } from "@/app/api/invite/accept/route";
import { POST as declinePOST } from "@/app/api/invite/decline/route";
import type { ExternalNotificationProviderPort } from "@/lib/services/notification-audit-service";

const DAY = 86_400_000;
let ipCounter = 100;
const post = (url: string, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-forwarded-for": `203.0.113.${(ipCounter++ % 250) + 1}`,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
const accept = (token: string) => acceptPOST(post("/api/invite/accept", { token }));
const decline = (token: string) => declinePOST(post("/api/invite/decline", { token }));

class CapturingProviders implements ExternalNotificationProviderPort {
  emails: Array<{ to: string; templateKey: string; actionUrl: string; vars: Record<string, unknown> }> = [];
  constructor(private readonly emailOk = true) {}
  async sendEmail(p: Parameters<ExternalNotificationProviderPort["sendEmail"]>[0]) {
    if (!this.emailOk) return { ok: false, error: "Resend is not configured on this server.", retryable: false };
    this.emails.push({
      to: p.to,
      templateKey: p.templateKey,
      actionUrl: String(p.safeVariables.actionUrl ?? ""),
      vars: p.safeVariables,
    });
    return { ok: true, providerMessageId: "m" };
  }
  async sendSms() {
    return { ok: true, providerMessageId: "s" };
  }
}

const tokenFrom = (url: string) => new URL(url).pathname.split("/").pop()!;
const key = Buffer.alloc(65, 4).toString("base64");

const created: string[] = [];
afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

async function setup(options: { emailOk?: boolean } = {}) {
  const { user, schedule } = await createTestUser("invite");
  created.push(user.id);
  await db.user.update({ where: { id: user.id }, data: { fullName: "Grace Owner" } });
  const providers = new CapturingProviders(options.emailOk ?? true);
  const engine = createEngine({ db, providers, appUrl: "https://dusk.test" });
  const service = new ContactService(new PrismaContactStore(db));

  /** Invite and email, exactly as the dashboard route does. */
  async function invite(
    email: string,
    roles: { isBeneficiary: boolean; isTrustedVerifier: boolean },
    now = new Date()
  ) {
    const { contact, rawInviteToken } = await service.inviteContact(
      user.id,
      {
        fullName: "Sam Invitee",
        email,
        ...roles,
        publicKeyBase64: roles.isBeneficiary ? key : undefined,
      },
      now
    );
    const { delivered } = await sendContactInvitationEmail(engine.notifier, {
      ownerUserId: user.id,
      ownerName: "Grace Owner",
      contact,
      rawToken: rawInviteToken,
      appUrl: engine.appUrl,
      now,
    });
    return { contact, rawInviteToken, delivered };
  }

  const contactRow = (id: string) => db.contact.findUniqueOrThrow({ where: { id } });
  const auditCount = (eventType: string) => db.auditEvent.count({ where: { userId: user.id, eventType } });
  return { user, schedule, providers, engine, service, invite, contactRow, auditCount };
}

describe("invitation flow on Postgres", () => {
  it("invite -> emailed link -> accept makes the person an accepted contact, once", async () => {
    const t = await setup();
    const email = `sam.${t.user.id}@example.test`;
    const { contact, rawInviteToken, delivered } = await t.invite(email, { isBeneficiary: true, isTrustedVerifier: true });

    // Created as waiting: not verified, a hashed token and a 14-day window.
    expect(delivered).toBe(true);
    const waiting = await t.contactRow(contact.id);
    expect(waiting.status).toBe("PENDING_INVITE");
    expect(waiting.verifiedAt).toBeNull();
    expect(waiting.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(waiting.inviteTokenHash).not.toBe(rawInviteToken);
    expect(waiting.publicKeyBase64).toBe(key); // the beneficiary key is stored at creation
    const lifetime = waiting.inviteExpiresAt!.getTime() - Date.now();
    expect(lifetime).toBeGreaterThan(INVITE_TTL_MS - 60_000);
    expect(lifetime).toBeLessThanOrEqual(INVITE_TTL_MS);

    // The email carries /invite/<token>, names the owner and both roles, and goes to the invitee.
    expect(t.providers.emails).toHaveLength(1);
    const mail = t.providers.emails[0];
    expect(mail.templateKey).toBe("CONTACT_INVITATION");
    expect(mail.to).toBe(email);
    expect(mail.actionUrl).toBe(`https://dusk.test/invite/${rawInviteToken}`);
    expect(mail.vars).toMatchObject({ ownerName: "Grace Owner", isBeneficiary: true, isTrustedVerifier: true });

    // The raw token is stored nowhere: not on the contact, not in audit rows, not in the delivery log.
    const audits = await db.auditEvent.findMany({ where: { userId: t.user.id } });
    const deliveries = await db.notificationDelivery.findMany({ where: { userId: t.user.id } });
    expect(JSON.stringify([waiting, audits, deliveries])).not.toContain(rawInviteToken);
    expect(await t.auditCount("CONTACT_INVITED")).toBe(1);

    // Accept.
    const res = await accept(rawInviteToken);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      outcome: "accepted",
      ownerName: "Grace Owner",
      isBeneficiary: true,
      isTrustedVerifier: true,
    });
    // Nothing about the owner's email or the other contacts is revealed.
    expect(JSON.stringify(body)).not.toContain(t.user.email);
    expect(JSON.stringify(body)).not.toContain(email);

    const accepted = await t.contactRow(contact.id);
    expect(accepted.status).toBe("VERIFIED");
    expect(accepted.verifiedAt).not.toBeNull();
    expect(accepted.inviteTokenHash).toBeNull();
    expect(accepted.publicKeyBase64).toBe(key);
    expect(await t.auditCount("CONTACT_INVITE_ACCEPTED")).toBe(1);
  });

  it("a replayed link is refused and changes nothing", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(`r.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    expect((await accept(rawInviteToken)).status).toBe(200);

    for (const answer of [accept, decline]) {
      const replay = await answer(rawInviteToken);
      expect(replay.status).toBe(404);
      expect((await replay.json()).code).toBe("INVITATION_INVALID");
    }
    expect((await t.contactRow(contact.id)).status).toBe("VERIFIED");
    expect(await t.auditCount("CONTACT_INVITE_ACCEPTED")).toBe(1);
    expect(await t.auditCount("CONTACT_INVITE_DECLINED")).toBe(0);
  });

  it("an expired link is refused with a clear message, reported once, and leaves the person waiting", async () => {
    const t = await setup();
    // Invited 15 days ago: the 14-day link has run out.
    const { contact, rawInviteToken } = await t.invite(
      `e.${t.user.id}@example.test`,
      { isBeneficiary: false, isTrustedVerifier: true },
      new Date(Date.now() - 15 * DAY)
    );

    const first = await accept(rawInviteToken);
    expect(first.status).toBe(410);
    const body = await first.json();
    expect(body.code).toBe("INVITATION_EXPIRED");
    expect(body.error).toMatch(/expired/i);

    const row = await t.contactRow(contact.id);
    expect(row.status).toBe("PENDING_INVITE");
    expect(row.inviteTokenHash).toBeNull(); // withdrawn
    expect(row.inviteExpiresAt!.getTime()).toBeLessThan(Date.now()); // still shows as expired to the owner

    // Trying again is "not valid", and the expiry is recorded only once.
    expect((await accept(rawInviteToken)).status).toBe(404);
    expect(await t.auditCount("CONTACT_INVITE_EXPIRED")).toBe(1);
    expect((await t.contactRow(contact.id)).status).toBe("PENDING_INVITE");
  });

  it("an unknown or malformed token is refused", async () => {
    expect((await accept("x".repeat(43))).status).toBe(404);
    expect((await accept("short")).status).toBe(400);
    expect((await acceptPOST(post("/api/invite/accept", { nope: true }))).status).toBe(400);
    expect((await acceptPOST(post("/api/invite/accept", { token: { $ne: "" } }))).status).toBe(400);
  });

  it("refuses a request that comes from another site", async () => {
    const t = await setup();
    const { rawInviteToken, contact } = await t.invite(`x.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    const res = await acceptPOST(
      post("/api/invite/accept", { token: rawInviteToken }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" })
    );
    expect(res.status).toBe(403);
    expect((await t.contactRow(contact.id)).status).toBe("PENDING_INVITE");
  });

  it("two simultaneous accepts: exactly one wins", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(`c.${t.user.id}@example.test`, { isBeneficiary: true, isTrustedVerifier: false });

    const results = await Promise.all(Array.from({ length: 8 }, () => accept(rawInviteToken)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 404)).toHaveLength(7);

    expect((await t.contactRow(contact.id)).status).toBe("VERIFIED");
    expect(await t.auditCount("CONTACT_INVITE_ACCEPTED")).toBe(1);
  });

  it("an accept and a decline at the same moment: one outcome only", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(`d.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });

    const results = await Promise.all([accept(rawInviteToken), decline(rawInviteToken), accept(rawInviteToken), decline(rawInviteToken)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const final = (await t.contactRow(contact.id)).status;
    expect(["VERIFIED", "DECLINED"]).toContain(final);
    expect((await t.auditCount("CONTACT_INVITE_ACCEPTED")) + (await t.auditCount("CONTACT_INVITE_DECLINED"))).toBe(1);
  });

  it("resending replaces the token: the old link stops working, the new one works", async () => {
    const t = await setup();
    const { contact, rawInviteToken: oldToken } = await t.invite(`s.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });

    const again = await t.service.reinviteContact(t.user.id, contact.id);
    const sent = await sendContactInvitationEmail(t.engine.notifier, {
      ownerUserId: t.user.id,
      ownerName: "Grace Owner",
      contact: again.contact,
      rawToken: again.rawInviteToken,
      appUrl: t.engine.appUrl,
    });
    expect(sent.delivered).toBe(true);
    expect(t.providers.emails).toHaveLength(2); // a different token is a different invitation
    expect(tokenFrom(t.providers.emails[1].actionUrl)).toBe(again.rawInviteToken);
    expect(await t.auditCount("CONTACT_REINVITED")).toBe(1);

    expect((await accept(oldToken)).status).toBe(404);
    expect((await t.contactRow(contact.id)).status).toBe("PENDING_INVITE");
    expect((await accept(again.rawInviteToken)).status).toBe(200);
    expect((await t.contactRow(contact.id)).status).toBe("VERIFIED");
  });

  it("resending revives an expired invitation with a fresh 14 days", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(
      `z.${t.user.id}@example.test`,
      { isBeneficiary: false, isTrustedVerifier: true },
      new Date(Date.now() - 20 * DAY)
    );
    expect((await accept(rawInviteToken)).status).toBe(410);

    const again = await t.service.reinviteContact(t.user.id, contact.id);
    expect(again.contact.inviteExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    expect((await accept(again.rawInviteToken)).status).toBe(200);
  });

  it("only the owner can resend or cancel; an accepted person cannot be resent to", async () => {
    const t = await setup();
    const stranger = await createTestUser("stranger");
    created.push(stranger.user.id);
    const { contact, rawInviteToken } = await t.invite(`o.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });

    await expect(t.service.reinviteContact(stranger.user.id, contact.id)).rejects.toThrow(/not found or access denied/);
    await expect(t.service.cancelInvitation(stranger.user.id, contact.id)).rejects.toThrow(/not found or access denied/);
    expect((await t.contactRow(contact.id)).status).toBe("PENDING_INVITE");

    await accept(rawInviteToken);
    await expect(t.service.reinviteContact(t.user.id, contact.id)).rejects.toThrow(/already accepted/);
    await expect(t.service.cancelInvitation(t.user.id, contact.id)).rejects.toThrow(/has not been accepted/);
  });

  it("declining marks the invitation declined, drops the key, and the link is dead", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(`n.${t.user.id}@example.test`, { isBeneficiary: true, isTrustedVerifier: false });

    const res = await decline(rawInviteToken);
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("declined");

    const row = await t.contactRow(contact.id);
    expect(row.status).toBe("DECLINED");
    expect(row.publicKeyBase64).toBeNull();
    expect(row.inviteTokenHash).toBeNull();
    expect(row.verifiedAt).toBeNull();
    expect(await t.auditCount("CONTACT_INVITE_DECLINED")).toBe(1);
    expect((await accept(rawInviteToken)).status).toBe(404);
    await expect(t.service.reinviteContact(t.user.id, contact.id)).rejects.toThrow(/declined/);
  });

  it("cancelling an invitation withdraws the link and removes the person from the list", async () => {
    const t = await setup();
    const { contact, rawInviteToken } = await t.invite(`k.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    await t.service.cancelInvitation(t.user.id, contact.id);

    const row = await t.contactRow(contact.id);
    expect(row.status).toBe("REVOKED");
    expect(row.inviteTokenHash).toBeNull();
    expect((await accept(rawInviteToken)).status).toBe(404);
    expect(await t.auditCount("CONTACT_INVITE_CANCELED")).toBe(1);

    // The same email can be invited again later.
    const second = await t.invite(`k.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    expect(second.contact.id).toBe(contact.id);
    expect((await t.contactRow(contact.id)).status).toBe("PENDING_INVITE");
  });

  it("two 'add' requests for the same email at once create one contact", async () => {
    const t = await setup();
    const email = `dup.${t.user.id}@example.test`;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => t.invite(email, { isBeneficiary: false, isTrustedVerifier: true }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.contact.count({ where: { userId: t.user.id, email } })).toBe(1);
  });

  it("when the email cannot be sent the person stays waiting and nothing is verified", async () => {
    const t = await setup({ emailOk: false });
    const { contact, delivered } = await t.invite(`f.${t.user.id}@example.test`, { isBeneficiary: true, isTrustedVerifier: true });

    expect(delivered).toBe(false);
    const row = await t.contactRow(contact.id);
    expect(row.status).toBe("PENDING_INVITE");
    expect(row.verifiedAt).toBeNull();
    const log = await db.notificationDelivery.findMany({ where: { userId: t.user.id, templateKey: "CONTACT_INVITATION" } });
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe("FAILED");
  });

  it("a contact stored as VERIFIED before invitations existed still takes part (not rewritten)", async () => {
    const t = await setup();
    const legacy = await db.contact.create({
      data: {
        userId: t.user.id, fullName: "Legacy", email: `legacy.${t.user.id}@example.test`,
        isBeneficiary: false, isTrustedVerifier: true, status: "VERIFIED", verifiedAt: new Date(),
      },
    });
    await db.checkInSchedule.update({ where: { id: t.schedule.id }, data: verificationRequired() });
    await runSchedulerSweep(t.engine, { now: new Date(), onlyScheduleIds: [t.schedule.id] });
    expect(t.providers.emails.filter((m) => m.templateKey === "TRUSTED_VERIFIER_CHALLENGE").map((m) => m.to)).toEqual([legacy.email]);
    expect((await t.contactRow(legacy.id)).status).toBe("VERIFIED");
  });
});

function verificationRequired() {
  const due = new Date(Date.now() - 40 * DAY);
  return {
    state: "VERIFICATION_REQUIRED" as const,
    remindersSentCount: 3,
    lastCheckInAt: new Date(due.getTime() - 90 * DAY),
    nextDueAt: due,
    graceEndsAt: new Date(due.getTime() + 14 * DAY),
  };
}

describe("a person who has not accepted is invisible to the release engine", () => {
  it("is never asked to verify, and an accepted verifier is", async () => {
    const t = await setup();
    const pending = await t.invite(`pv.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    const declinedInvite = await t.invite(`dv.${t.user.id}@example.test`, { isBeneficiary: false, isTrustedVerifier: true });
    await decline(declinedInvite.rawInviteToken);
    const expiredInvite = await t.invite(
      `xv.${t.user.id}@example.test`,
      { isBeneficiary: false, isTrustedVerifier: true },
      new Date(Date.now() - 30 * DAY)
    );
    const baselineEmails = t.providers.emails.length; // the three invitations

    await db.checkInSchedule.update({ where: { id: t.schedule.id }, data: verificationRequired() });
    const sweep = await runSchedulerSweep(t.engine, { now: new Date(), onlyScheduleIds: [t.schedule.id] });

    expect(sweep.errors).toEqual([]);
    expect(sweep.verifierChallengesIssued).toBe(0);
    expect(sweep.releasesAuthorized).toBe(0);
    expect(t.providers.emails.length).toBe(baselineEmails); // no challenge went out
    expect(
      await db.releaseEvent.count({ where: { scheduleId: t.schedule.id, eventType: "VERIFIER_CHALLENGE_ISSUED" } })
    ).toBe(0);
    for (const id of [pending.contact.id, declinedInvite.contact.id, expiredInvite.contact.id]) {
      expect((await t.contactRow(id)).status).not.toBe("VERIFIED");
    }

    // Once they accept, the next sweep challenges them (and only them).
    expect((await accept(pending.rawInviteToken)).status).toBe(200);
    const next = await runSchedulerSweep(t.engine, { now: new Date(Date.now() + 1000), onlyScheduleIds: [t.schedule.id] });
    expect(next.verifierChallengesIssued).toBe(1);
    expect(t.providers.emails.filter((m) => m.templateKey === "TRUSTED_VERIFIER_CHALLENGE").map((m) => m.to)).toEqual([
      pending.contact.email,
    ]);
  });

  it("never gets a release package, and an accepted beneficiary does", async () => {
    const t = await setup();
    const pending = await t.invite(`pb.${t.user.id}@example.test`, { isBeneficiary: true, isTrustedVerifier: false });
    const declinedInvite = await t.invite(`db.${t.user.id}@example.test`, { isBeneficiary: true, isTrustedVerifier: false });
    await decline(declinedInvite.rawInviteToken);
    const baselineEmails = t.providers.emails.length;

    // The estate has already been released (all policy checks done elsewhere): who is told?
    await db.checkInSchedule.update({ where: { id: t.schedule.id }, data: { ...verificationRequired(), state: "RELEASED" } });
    const sweep = await runSchedulerSweep(t.engine, { now: new Date(), onlyScheduleIds: [t.schedule.id] });
    expect(sweep.errors).toEqual([]);
    expect(sweep.beneficiaryGrantsIssued).toBe(0);
    expect(t.providers.emails.length).toBe(baselineEmails);
    expect(
      await db.releaseEvent.count({ where: { scheduleId: t.schedule.id, eventType: "BENEFICIARY_ACCESS_GRANT_ISSUED" } })
    ).toBe(0);

    expect((await accept(pending.rawInviteToken)).status).toBe(200);
    const next = await runSchedulerSweep(t.engine, { now: new Date(Date.now() + 1000), onlyScheduleIds: [t.schedule.id] });
    expect(next.beneficiaryGrantsIssued).toBe(1);
    expect(t.providers.emails.filter((m) => m.templateKey === "RELEASE_PACKAGE_READY").map((m) => m.to)).toEqual([
      pending.contact.email,
    ]);
  });
});
