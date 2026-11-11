// tests/e2e/invites.spec.ts
// The invitation flow in a real browser, against the dev server and the Neon dev branch.
// Pending invitations are created through the database helpers (the dev server has no email
// provider, so no email is sent). Throwaway rows are removed afterwards.
import { expect, test, type Page } from "@playwright/test";
import { cleanupUser, createTestUser, db } from "../integration/helpers";
import { generateOpaqueToken } from "../../lib/auth/security";

const DAY = 86_400_000;
const created: string[] = [];

// The invitation endpoints are rate limited per caller address. Give every test its own address so
// repeated runs inside the 15-minute window do not use each other up.
const randomOctet = () => Math.floor(Math.random() * 254) + 1;
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": `10.${randomOctet()}.${randomOctet()}.${randomOctet()}` });
});

test.afterAll(async () => {
  for (const id of created) await cleanupUser(id);
  await db.$disconnect();
});

/** An owner with one waiting invitation, built straight in the database. */
async function pendingInvite(
  roles: { isBeneficiary: boolean; isTrustedVerifier: boolean },
  options: { ownerName?: string | null; expiresAt?: Date } = {}
) {
  const { user } = await createTestUser("e2einvite");
  created.push(user.id);
  const ownerName = options.ownerName === undefined ? "Grace Owner" : options.ownerName;
  await db.user.update({ where: { id: user.id }, data: { fullName: ownerName } });

  const { rawToken, tokenHash } = generateOpaqueToken();
  const contact = await db.contact.create({
    data: {
      userId: user.id,
      fullName: "Sam Invitee",
      email: `sam.${user.id}@example.test`,
      ...roles,
      status: "PENDING_INVITE",
      inviteTokenHash: tokenHash,
      inviteExpiresAt: options.expiresAt ?? new Date(Date.now() + 14 * DAY),
      publicKeyBase64: roles.isBeneficiary ? Buffer.alloc(65, 2).toString("base64") : null,
    },
  });
  return { user, contact, token: rawToken };
}

const status = (id: string) => db.contact.findUniqueOrThrow({ where: { id } }).then((c) => c.status);

test("an unknown invitation link explains itself and offers nothing to click", async ({ page }) => {
  await page.goto("/invite/this-is-not-a-real-token-value");
  await expect(page.getByRole("heading", { name: "This invitation link isn't valid" })).toBeVisible();
  await expect(page.getByText(/may have been used already, or the person may have cancelled it/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Decline/ })).toHaveCount(0);
});

test("a valid link names the owner and role, does nothing on load, and accepts on one click", async ({ page }) => {
  const { contact, token, user } = await pendingInvite({ isBeneficiary: true, isTrustedVerifier: true });

  await page.goto(`/invite/${token}`);
  await expect(
    page.getByRole("heading", { name: "Grace Owner has asked you to be a beneficiary and a trusted verifier" })
  ).toBeVisible();
  await expect(page.getByText(/you would receive the items Grace Owner chooses for you/)).toBeVisible();
  await expect(page.getByText(/help confirm that Grace Owner is okay/)).toBeVisible();
  await expect(page.getByText(/does not give you access to anything today/)).toBeVisible();
  await expect(page.getByText(/expires on/)).toBeVisible();
  // Never reveals the owner's email address or the invitee's own record.
  await expect(page.locator("body")).not.toContainText(user.email);
  await expect(page.locator("body")).not.toContainText(contact.email);

  // Opening (and reloading) the link must not accept anything.
  await page.reload();
  await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();
  expect(await status(contact.id)).toBe("PENDING_INVITE");

  await page.getByRole("button", { name: "Accept invitation" }).click();
  const done = page.getByRole("heading", { name: "Thank you. You've accepted" });
  await expect(done).toBeVisible();
  await expect(done).toBeFocused();
  await expect(page.getByText(/separate private link for opening your items/)).toBeVisible();
  expect(await status(contact.id)).toBe("VERIFIED");

  // The same link cannot be used again.
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "This invitation link isn't valid" })).toBeVisible();
});

test("a trusted verifier is told what they confirm and what they cannot see", async ({ page }) => {
  const { token } = await pendingInvite({ isBeneficiary: false, isTrustedVerifier: true });
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: /asked you to be a trusted verifier$/ })).toBeVisible();
  await expect(page.getByText(/you cannot see anything they have stored/)).toBeVisible();
  await expect(page.getByText(/would receive the items/)).toHaveCount(0);
});

test("declining is one click and ends the invitation", async ({ page }) => {
  const { contact, token } = await pendingInvite({ isBeneficiary: true, isTrustedVerifier: false });
  await page.goto(`/invite/${token}`);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("heading", { name: "You've declined" })).toBeVisible();
  expect(await status(contact.id)).toBe("DECLINED");

  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "This invitation link isn't valid" })).toBeVisible();
});

test("an expired link says so plainly", async ({ page }) => {
  const { token, contact } = await pendingInvite(
    { isBeneficiary: false, isTrustedVerifier: true },
    { expiresAt: new Date(Date.now() - DAY) }
  );
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  await expect(page.getByText(/Ask the person who invited you to send a new one/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Accept/ })).toHaveCount(0);
  expect(await status(contact.id)).toBe("PENDING_INVITE");
});

test("a link that expires while the page is open is reported when the person clicks", async ({ page }) => {
  const { token, contact } = await pendingInvite({ isBeneficiary: false, isTrustedVerifier: true });
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("button", { name: "Accept invitation" })).toBeVisible();

  // Meanwhile the link runs out.
  await db.contact.update({ where: { id: contact.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("heading", { name: "This invitation has expired" })).toBeVisible();
  expect(await status(contact.id)).toBe("PENDING_INVITE");
});

test("a link with no owner name falls back to neutral wording, never an email", async ({ page }) => {
  const { token, user } = await pendingInvite({ isBeneficiary: true, isTrustedVerifier: false }, { ownerName: null });
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "Someone you know has asked you to be a beneficiary" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(user.email);
});

async function signUp(page: Page) {
  const email = `invites.test.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Invites Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("A-long-test-passphrase-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  return email;
}

test("the owner sees waiting, not-sent, resend and cancel, and only accepted people count", async ({ page }) => {
  const ownerEmail = await signUp(page);
  await page.getByRole("button", { name: /People & access/ }).first().click();
  await expect(page.getByRole("heading", { name: "People & access" })).toBeVisible();
  // The Dusk account row is created when the dashboard first loads.
  const owner = await db.user.findFirstOrThrow({ where: { email: ownerEmail } });
  created.push(owner.id);
  await expect(page.getByText(/Only people who have accepted their invitation can take part/)).toBeVisible();

  await page.getByLabel("Full name").fill("Elena Ruiz");
  await page.getByLabel("Email address").fill(`elena.${Date.now()}@example.com`);
  await page.getByRole("checkbox", { name: /^Beneficiary/ }).uncheck();
  await page.getByRole("checkbox", { name: /^Trusted verifier/ }).check();
  await page.getByRole("button", { name: "Send invitation" }).click();

  // The dev server has no email provider, so the invitation cannot be sent: say so, keep her waiting.
  await expect(page.getByText(/We couldn't send the invitation to Elena Ruiz/)).toBeVisible();
  const row = page.locator("div.py-4", { hasText: "Elena Ruiz" });
  await expect(row.getByText("Invitation not sent")).toBeVisible();
  await expect(row.getByText("We couldn't send the invitation. Try again.")).toBeVisible();
  const contact = await db.contact.findFirstOrThrow({ where: { userId: owner.id } });
  expect(contact.status).toBe("PENDING_INVITE");
  expect(contact.verifiedAt).toBeNull();

  // Overview counts only accepted people.
  await page.getByRole("button", { name: /Overview/ }).first().click();
  await expect(page.getByText("Waiting for them to accept").first()).toBeVisible();
  await page.getByRole("button", { name: /People & access/ }).first().click();

  // Resend replaces the link (the old token hash is gone) and, with no provider, still says not sent.
  const before = (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).inviteTokenHash;
  await row.getByRole("button", { name: "Resend invitation to Elena Ruiz" }).click();
  await expect(page.getByText(/We couldn't send the invitation to Elena Ruiz\. Try again\./)).toBeVisible();
  const after = (await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).inviteTokenHash;
  expect(after).not.toBe(before);

  // She accepts through a link made by the database helper (no email provider here).
  const { rawToken, tokenHash } = generateOpaqueToken();
  await db.contact.update({ where: { id: contact.id }, data: { inviteTokenHash: tokenHash } });
  const invitee = await page.context().newPage();
  await invitee.goto(`/invite/${rawToken}`);
  await invitee.getByRole("button", { name: "Accept invitation" }).click();
  await expect(invitee.getByRole("heading", { name: "Thank you. You've accepted" })).toBeVisible();
  await invitee.close();

  await page.reload();
  await page.getByRole("button", { name: /People & access/ }).first().click();
  const accepted = page.locator("div.py-4", { hasText: "Elena Ruiz" });
  await expect(accepted.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(accepted.getByRole("button", { name: /Resend invitation/ })).toHaveCount(0);
  await expect(accepted.getByRole("button", { name: /Cancel invitation/ })).toHaveCount(0);

  // A second person is invited and then cancelled.
  await page.getByLabel("Full name").fill("Omar Said");
  await page.getByLabel("Email address").fill(`omar.${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Send invitation" }).click();
  const omar = page.locator("div.py-4", { hasText: "Omar Said" });
  await expect(omar.getByRole("button", { name: "Cancel invitation to Omar Said" })).toBeVisible();
  await omar.getByRole("button", { name: "Cancel invitation to Omar Said" }).click();
  await page.getByRole("button", { name: "Cancel invitation", exact: true }).last().click();
  await expect(page.getByText("Invitation cancelled. The link in their email no longer works.")).toBeVisible();
  await expect(page.locator("div.py-4", { hasText: "Omar Said" })).toHaveCount(0);
});
