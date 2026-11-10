// tests/e2e/auth-and-links.spec.ts
import { expect, test } from "@playwright/test";

test("a signed-out visitor is sent to the sign-in page", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong credentials show a readable error and stay on sign-in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("not-the-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a new person can create an account and land on their dashboard, and stay signed in", async ({ page }) => {
  const email = `e2e.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("E2E Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("A-long-test-passphrase-2026!");
  await page.getByRole("button", { name: "Create account" }).click();

  // Dev branch has email verification off, so sign-up signs the person straight in.
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard/);

  // The signed-in person is not shown the sign-in page again.
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("an invalid check-in link explains itself instead of pretending to work", async ({ page }) => {
  await page.goto("/checkin/this-is-not-a-real-token-value");
  // Opening the link must not check anyone in: it only shows a button.
  await expect(page.getByRole("heading", { name: /Confirm you're okay/ })).toBeVisible();
  await page.getByRole("button", { name: "I'm okay, check me in" }).click();
  await expect(page.locator("p[role=\"alert\"]")).toContainText(/invalid|not valid|expired|already used/i);
});

test("an invalid verifier link is refused after the verifier answers", async ({ page }) => {
  await page.goto("/verify/this-is-not-a-real-token-value");
  await page.getByLabel("I know they are alive").check();
  await page.getByLabel("In a sentence, how do you know?").fill("I spoke to them today.");
  await page.getByRole("button", { name: "Send my answer" }).click();
  await expect(page.locator("p[role=\"alert\"]")).toContainText(/not valid|expired|already used/i);
});
