// tests/e2e/dashboard-signout.spec.ts
// There is exactly one way to sign out in the dashboard shell: a full-width button directly below
// the person's name, in the sidebar on desktop and in the menu on a phone. No icon beside the name,
// and nothing in the top bar. Runs on localhost against the dev database branch.
import { expect, test, type Page } from "@playwright/test";
import { ACCOUNT_PASSWORD } from "./helpers/vault";

async function signedIn(page: Page, label: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  // On a phone the navigation is inside a closed menu, so wait for the page heading instead.
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Signout Tester");
  await page.getByLabel("Email").fill(`signout.test.${label}.${Date.now()}@example.com`);
  await page.getByLabel("Password").fill(ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
}

test("desktop: one Sign out, in the sidebar below the name, none in the top bar", async ({ page }) => {
  await signedIn(page, "signout-desktop", 1440, 900);

  const signOut = page.getByRole("button", { name: "Sign out" });
  await expect(signOut).toHaveCount(1);
  await expect(signOut).toBeVisible();
  await expect(page.locator("header").getByRole("button", { name: "Sign out" })).toHaveCount(0);

  // It sits inside the sidebar footer, below the name, and is a full-width labelled button.
  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "Sign out" })).toHaveCount(1);
  const name = sidebar.getByText("Personal account");
  const nameBox = await name.boundingBox();
  const buttonBox = await signOut.boundingBox();
  expect(nameBox && buttonBox && buttonBox.y > nameBox.y + nameBox.height).toBe(true);
  expect(buttonBox?.width ?? 0).toBeGreaterThan(150);
  expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(signOut).toHaveText("Sign out");
});

test("phone: the menu has one Sign out, below the name", async ({ page }) => {
  await signedIn(page, "signout-phone", 390, 844);

  // Closed menu: nothing to sign out with is visible, and the top bar has none.
  await expect(page.getByRole("button", { name: "Sign out" }).filter({ visible: true })).toHaveCount(0);
  await expect(page.locator("header").getByRole("button", { name: "Sign out" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation menu" });
  const signOut = drawer.getByRole("button", { name: "Sign out" });
  await expect(signOut).toHaveCount(1);
  await expect(signOut).toBeVisible();

  const nameBox = await drawer.getByText("Personal account").boundingBox();
  const buttonBox = await signOut.boundingBox();
  expect(nameBox && buttonBox && buttonBox.y > nameBox.y + nameBox.height).toBe(true);
  expect(buttonBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("the Sign out button signs the person out", async ({ page }) => {
  await signedIn(page, "signout-works", 1440, 900);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).not.toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
});
