// tests/e2e/delete-account.spec.ts
// Drives the real Settings "Delete account" section against the dev server and the Neon DEV
// branch, with throwaway accounts only. The emailed code is read from the dev database (see
// helpers/auth-otp.ts, which refuses to run against production).
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { closeOtpDb, readDeletionOtp } from "./helpers/auth-otp";
import { db } from "../integration/helpers";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const EMAIL_A = `retention.test.${STAMP}@example.com`;
const EMAIL_B = `retention.test.other.${STAMP}@example.com`;
const PASSWORD = `Delete-test-pass-${STAMP}`;
const PASSWORD_AGAIN = `Delete-again-pass-${STAMP}`;

async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return !!form && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await hydrated(page);
}

async function fillAndKeep(page: Page, label: string, value: string, exact = false) {
  const field = page.getByLabel(label, { exact });
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function register(page: Page, email: string, password: string) {
  await open(page, "/register");
  await page.getByLabel("Full name").fill("Delete Test");
  await fillAndKeep(page, "Email", email);
  await fillAndKeep(page, "Password", password, true);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function signIn(page: Page, email: string, password: string) {
  await open(page, "/login");
  await fillAndKeep(page, "Email", email);
  await fillAndKeep(page, "Password", password, true);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signedInContext(browser: Browser, email: string, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email, password);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  return { context, page };
}

/** Everything on this page named like a password-change control is scoped to the delete section. */
const del = (page: Page) => page.locator("#delete-account");

async function openDeleteSection(page: Page) {
  // On a phone the sidebar is a drawer behind the menu button.
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  await expect(menu.or(page.getByRole("button", { name: "Settings" }).first())).toBeVisible({ timeout: 30_000 });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole("button", { name: "Settings" }).last().click();
  } else {
    await page.getByRole("button", { name: "Settings" }).first().click();
  }
  await expect(page.getByRole("heading", { name: "Delete account" })).toBeVisible();
}

/** Calls the delete route from inside the signed-in page, so it carries the real cookies and origin. */
async function postDelete(page: Page, body: Record<string, unknown>) {
  return page.evaluate(async (payload) => {
    const res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as { code?: string; error?: string; ok?: boolean } | null };
  }, body);
}

async function counts(email: string) {
  const [dusk, neon] = await Promise.all([
    db.user.count({ where: { email } }),
    db.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM neon_auth."user" WHERE email = ${email}`,
  ]);
  return { dusk, neon: neon[0].n };
}

test.afterAll(async () => {
  // Safety net for a failed run: remove anything left of the two throwaway accounts.
  for (const email of [EMAIL_A, EMAIL_B]) {
    await db.user.deleteMany({ where: { email } });
    await db.$executeRaw`DELETE FROM neon_auth."user" WHERE email = ${email}`;
  }
  await closeOtpDb();
});

test("the Delete account section explains what is deleted and starts with an emailed code", async ({ page }) => {
  await register(page, EMAIL_A, PASSWORD);
  await openDeleteSection(page);

  const section = page.locator("#delete-account");
  await expect(section.getByText("This permanently deletes your Dusk account. It cannot be undone.")).toBeVisible();
  await expect(section.getByText("Your encrypted vault: every item and folder, and your recovery data.")).toBeVisible();
  await expect(section.getByText("The people you added, and what you set aside for each of them.")).toBeVisible();
  await expect(section.getByText("Your check-in schedule and its history", { exact: false })).toBeVisible();
  await expect(section.getByText("Dusk can't read your vault, so we can't restore or recover any of it.", { exact: false })).toBeVisible();
  await expect(section.getByText("The people you named lose any role they had.", { exact: false })).toBeVisible();
  // No release yet: the plain note, not the red warning.
  await expect(section.getByText("Deleting your account also ends your check-in plan.", { exact: false })).toBeVisible();

  // Nothing can be typed or confirmed before a code is requested.
  await expect(del(page).getByLabel("6-digit code")).toHaveCount(0);
  await del(page).getByRole("button", { name: "Delete my account..." }).click();
  await expect(del(page).getByLabel("Type your email to confirm")).toHaveCount(0);
  await del(page).getByRole("button", { name: "Cancel" }).last().click();
  await expect(del(page).getByRole("button", { name: "Delete my account..." })).toBeFocused();
});

test("wrong confirmation text and wrong or foreign codes are refused, and nothing is deleted", async ({ page, browser }) => {
  await signIn(page, EMAIL_A, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await openDeleteSection(page);

  await del(page).getByRole("button", { name: "Delete my account..." }).click();
  await del(page).getByRole("button", { name: "Email me a code" }).click();
  await expect(del(page).getByText("We sent a 6-digit code to").filter({ hasText: EMAIL_A })).toBeVisible();
  await expect(del(page).getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
  const code = await readDeletionOtp(EMAIL_A);
  const wrongCode = code === "111111" ? "222222" : "111111";

  // The page checks obvious slips before sending anything.
  await del(page).getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(del(page).getByText("Enter the 6-digit code from your email.")).toBeVisible();
  await expect(del(page).getByText("That isn't the email on your account.")).toBeVisible();

  // Wrong confirmation text with the right code: refused, and the code is not used up.
  await del(page).getByLabel("6-digit code").fill(code);
  await del(page).getByLabel("Type your email to confirm").fill("not-my-email@example.com");
  await del(page).getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(del(page).getByText("That isn't the email on your account.")).toBeVisible();

  // The server refuses a wrong typed email on its own, before it even looks at the code.
  const serverMismatch = await postDelete(page, { confirmEmail: "not-my-email@example.com", code });
  expect(serverMismatch).toMatchObject({ status: 400, body: { code: "EMAIL_MISMATCH" } });

  // A wrong code with the right email is refused by the server.
  await del(page).getByLabel("Type your email to confirm").fill(EMAIL_A);
  await del(page).getByLabel("6-digit code").fill(wrongCode);
  await del(page).getByRole("button", { name: "Delete my account permanently" }).click();
  await expect(del(page).getByRole("alert").filter({ hasText: "That code isn't right" })).toBeVisible();

  // Someone else, signed in as themselves, cannot use this account's code, nor name this account's email.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await register(otherPage, EMAIL_B, PASSWORD);
  // Wait until the dashboard has created this account's Dusk row, so the calls below are not
  // racing the page's own first load.
  await expect.poll(async () => (await counts(EMAIL_B)).dusk, { timeout: 30_000 }).toBe(1);
  const other = { context: otherContext, page: otherPage };
  const foreignCode = await postDelete(other.page, { confirmEmail: EMAIL_B, code });
  expect(foreignCode).toMatchObject({ status: 400, body: { code: "CODE_INVALID" } });
  const foreignEmail = await postDelete(other.page, { confirmEmail: EMAIL_A, code });
  expect(foreignEmail).toMatchObject({ status: 400, body: { code: "EMAIL_MISMATCH" } });
  // A request cannot name another account or add fields: only the signed-in person is ever deleted.
  const extra = await postDelete(other.page, { confirmEmail: EMAIL_B, code, userId: "someone-else" });
  expect(extra.status).toBe(400);
  await other.context.close();

  // Both accounts are untouched.
  expect(await counts(EMAIL_A)).toEqual({ dusk: 1, neon: 1 });
  expect(await counts(EMAIL_B)).toEqual({ dusk: 1, neon: 1 });
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("deleting needs a same-origin request and a signed-in person", async ({ page, request }) => {
  await open(page, "/login");
  // No cookies: not signed in.
  const anonymous = await request.post("/api/account/delete", {
    data: { confirmEmail: EMAIL_A, code: "123456" },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(anonymous.status()).toBe(401);
  // A cross-site origin is refused before anything else.
  const crossSite = await request.post("/api/account/delete", {
    data: { confirmEmail: EMAIL_A, code: "123456" },
    headers: { origin: "https://evil.example.com" },
  });
  expect(crossSite.status()).toBe(403);
  expect((await request.get("/api/account/delete")).status()).toBe(401);
});

test("the right code and email delete the account: signed out everywhere, old sign-in refused, same email registers again", async ({ page, browser }) => {
  // A second device signed in as the same person.
  const second = await signedInContext(browser, EMAIL_A, PASSWORD);

  await signIn(page, EMAIL_A, PASSWORD);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await openDeleteSection(page);
  await del(page).getByRole("button", { name: "Delete my account..." }).click();
  await del(page).getByRole("button", { name: "Email me a code" }).click();
  await expect(del(page).getByText("We sent a 6-digit code to").filter({ hasText: EMAIL_A })).toBeVisible();
  const code = await readDeletionOtp(EMAIL_A);

  await del(page).getByLabel("6-digit code").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await del(page).getByLabel("Type your email to confirm").fill(EMAIL_A.toUpperCase());
  await del(page).getByRole("button", { name: "Delete my account permanently" }).click();

  await expect(page).toHaveURL(/\/account-deleted$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();
  await expect(page.getByText("You are signed out on every device.")).toBeVisible();
  expect(await counts(EMAIL_A)).toEqual({ dusk: 0, neon: 0 });

  // This browser is signed out, and so is the other device.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await second.page.goto("/dashboard");
  await expect(second.page).toHaveURL(/\/login/, { timeout: 30_000 });
  await second.context.close();

  // The old email and password no longer work.
  await signIn(page, EMAIL_A, PASSWORD);
  await expect(page.getByText("That email and password don't match.")).toBeVisible();

  // The same email can register again, as a brand new account with its own new password.
  await register(page, EMAIL_A, PASSWORD_AGAIN);
  await expect.poll(async () => (await counts(EMAIL_A)).dusk, { timeout: 30_000 }).toBe(1);
  const fresh = await db.user.findUniqueOrThrow({ where: { email: EMAIL_A }, include: { vault: true } });
  expect(fresh.vault).toBeNull();
  // And the other test account is still there.
  expect(await counts(EMAIL_B)).toEqual({ dusk: 1, neon: 1 });
});

test("a release in progress or finished is warned about plainly and needs a tick box; the layout fits on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await signIn(page, EMAIL_A, PASSWORD_AGAIN);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  const cases = [
    { impact: "IN_PROGRESS", text: "A release is under way for your plan." },
    { impact: "RELEASED", text: "Your plan has already been released." },
  ] as const;
  for (const { impact, text } of cases) {
    // Pretend the server reports this release state, so the warning copy and the tick box can be checked.
    await page.route("**/api/account/delete", async (route) => {
      if (route.request().method() === "GET") await route.fulfill({ json: { releaseImpact: impact } });
      else await route.continue();
    });
    await page.goto("/dashboard");
    await openDeleteSection(page);
    await expect(del(page).getByText(text)).toBeVisible();
    await del(page).getByRole("button", { name: "Delete my account..." }).click();
    await del(page).getByRole("button", { name: "Email me a code" }).click();
    await expect(del(page).getByText("We sent a 6-digit code to")).toBeVisible();
    const code = await readDeletionOtp(EMAIL_A);
    await del(page).getByLabel("6-digit code").fill(code);
    await del(page).getByLabel("Type your email to confirm").fill(EMAIL_A);

    // Right code and email, but the box is not ticked: refused before anything is sent.
    await del(page).getByRole("button", { name: "Delete my account permanently" }).click();
    await expect(del(page).getByText("Please tick the box to confirm you understand.")).toBeVisible();
    expect(await counts(EMAIL_A)).toEqual({ dusk: 1, neon: 1 });

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.unroute("**/api/account/delete");
  }
});

test("the confirmation page is public and says plainly what happened", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/account-deleted");
  await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a new account" })).toBeVisible();
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", /noindex/);
});
