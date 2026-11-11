// tests/e2e/password-reset-and-change.spec.ts
// Drives the real forgot-password page and the Settings "Change password" card against the dev
// server and the Neon DEV branch. The emailed code is read from the dev database (see helpers/auth-otp.ts,
// which refuses to run against production).
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { closeOtpDb, readResetOtp } from "./helpers/auth-otp";

test.describe.configure({ mode: "serial" });

const STAMP = Date.now();
const EMAIL = `auth.test.${STAMP}@example.com`;
const PASSWORD_1 = `First-test-pass-${STAMP}`;
const PASSWORD_2 = `Second-test-pass-${STAMP}`;
const PASSWORD_3 = `Third-test-pass-${STAMP}`;

test.afterAll(async () => {
  await closeOtpDb();
});

/** Waits until React has taken over the page's form, so typing and clicking are not wiped by hydration. */
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

/** Fills a controlled input and checks it kept the value, retrying if hydration wiped it just after load. */
async function fillAndKeep(page: Page, label: string, value: string, exact = false) {
  const field = page.getByLabel(label, { exact });
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function register(page: Page) {
  await open(page, "/register");
  await page.getByLabel("Full name").fill("Auth Test");
  await fillAndKeep(page, "Email", EMAIL);
  await fillAndKeep(page, "Password", PASSWORD_1, true);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function signIn(page: Page, password: string) {
  await open(page, "/login");
  await fillAndKeep(page, "Email", EMAIL);
  await fillAndKeep(page, "Password", password, true);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signedInContext(browser: Browser, password: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, password);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  return { context, page };
}

test("login page links to the forgot-password page", async ({ page }) => {
  await open(page, "/login");
  const link = page.getByRole("link", { name: "Forgot password?" });
  await expect(link).toBeVisible();
  const box = await link.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
});

test("an email with no account gets the same neutral message as a real one", async ({ page }) => {
  await open(page, "/forgot-password");
  await fillAndKeep(page, "Email", `auth.test.nobody.${STAMP}@example.com`);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByText("If an account uses that email, we've sent a 6-digit code.")).toBeVisible();
  // The resend button is locked for 60 seconds.
  await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();
  // A made-up code is refused, and nothing says whether the account exists.
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByLabel("New password", { exact: true }).fill(PASSWORD_2);
  await page.getByLabel("Confirm new password").fill(PASSWORD_2);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /isn't right|expired|couldn't/i })).toBeVisible();
});

test("the reset form explains problems next to the box that needs fixing", async ({ page }) => {
  await open(page, "/forgot-password");
  await fillAndKeep(page, "Email", `auth.test.nobody2.${STAMP}@example.com`);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();

  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Enter the 6-digit code from your email.")).toBeVisible();
  await expect(page.getByText("Enter a new password.")).toBeVisible();

  await page.getByLabel("6-digit code").fill("123456");
  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();

  await page.getByLabel("New password", { exact: true }).fill(PASSWORD_2);
  await page.getByLabel("Confirm new password").fill(`${PASSWORD_2}x`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("The two passwords don't match.")).toBeVisible();

  // Show / hide toggle.
  const field = page.getByLabel("New password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show new password" }).click();
  await expect(field).toHaveAttribute("type", "text");
});

test("register refuses a password shorter than 10 characters", async ({ page }) => {
  await open(page, "/register");
  await page.getByLabel("Full name").fill("Short Pass");
  await page.getByLabel("Email").fill(`auth.test.short.${STAMP}@example.com`);
  await expect(page.getByText("At least 10 characters.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use at least 10 characters.")).toBeVisible();
  await expect(page).toHaveURL(/\/register/);
});

test("forgot password: full reset with the emailed code, other sessions end, old password stops working", async ({
  page,
  browser,
}) => {
  await register(page);

  // A second device that is signed in when the reset happens.
  const other = await signedInContext(browser, PASSWORD_1);

  // The first browser signs out, as someone who forgot their password would be.
  await page.context().clearCookies();
  await open(page, "/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await hydrated(page);
  await fillAndKeep(page, "Email", EMAIL);
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("If an account uses that email, we've sent a 6-digit code.")).toBeVisible();

  const code = await readResetOtp(EMAIL);

  // A wrong code is refused first (this uses one of the three attempts).
  await page.getByLabel("6-digit code").fill(code === "111111" ? "222222" : "111111");
  await page.getByLabel("New password", { exact: true }).fill(PASSWORD_2);
  await page.getByLabel("Confirm new password").fill(PASSWORD_2);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That code isn't right" })).toBeVisible();

  // The right code, typed with a space like a person might paste it.
  await page.getByLabel("6-digit code").fill(`${code.slice(0, 3)} ${code.slice(3)}`);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  // The code works only once.
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  await hydrated(page);

  // Old password no longer works.
  await signIn(page, PASSWORD_1);
  await expect(page.getByText("That email and password don't match.")).toBeVisible();

  // New password works.
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD_2);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  // The other device was signed out by the reset (the dev branch revokes sessions on reset).
  await other.page.goto("/dashboard");
  await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
  await other.context.close();
});

test("settings: change password needs an emailed code, keeps this device, ends other devices", async ({
  page,
  browser,
}) => {
  await signIn(page, PASSWORD_2);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  const other = await signedInContext(browser, PASSWORD_2);

  await page.getByRole("button", { name: "Settings" }).first().click();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();

  // Nothing can be changed before a code is requested.
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText("We sent a 6-digit code to").filter({ hasText: EMAIL })).toBeVisible();
  await expect(page.getByRole("button", { name: /Send a new code in \d+s/ })).toBeDisabled();

  // Wrong code first.
  const code = await readResetOtp(EMAIL);
  await page.getByLabel("6-digit code").fill(code === "333333" ? "444444" : "333333");
  await page.getByLabel("New password", { exact: true }).fill(PASSWORD_3);
  await page.getByLabel("Confirm new password").fill(PASSWORD_3);
  await page.getByRole("button", { name: "Change password" }).last().click();
  await expect(page.getByRole("alert").filter({ hasText: "That code isn't right" })).toBeVisible();

  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Change password" }).last().click();
  await expect(page.getByText("Your password is changed. We also signed you out on every other device.")).toBeVisible({
    timeout: 30_000,
  });

  // This device is still signed in after a reload.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);

  // The other device is signed out.
  await other.page.goto("/dashboard");
  await expect(other.page).toHaveURL(/\/login/, { timeout: 30_000 });
  await other.context.close();

  // Old password refused, new password accepted.
  await page.context().clearCookies();
  await signIn(page, PASSWORD_2);
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD_3);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
});

test("a signed-in person is sent away from the forgot-password page", async ({ page }) => {
  await signIn(page, PASSWORD_3);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.goto("/forgot-password");
  await expect(page).toHaveURL(/\/dashboard/);
});
