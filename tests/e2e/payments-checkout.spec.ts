// tests/e2e/payments-checkout.spec.ts
// The buy-lifetime-access experience in a real browser. The payment provider is never contacted
// by these tests except where noted: /api/checkout is stubbed with page.route so the page's own
// behaviour (redirect, errors, double-click safety) can be checked.
import { expect, test, type Page } from "@playwright/test";
import { db } from "../integration/helpers";

const PASSWORD = "A-long-test-passphrase-2026!";
const FAKE_CHECKOUT = "https://dusk-test.lemonsqueezy.com/checkout/custom/e2e";
const ERROR_TEXT = "We couldn't start checkout. You haven't been charged. Please try again in a moment.";

const emails: string[] = [];
test.afterAll(async () => {
  // Remove the Dusk-side rows of the throwaway accounts created below.
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});

function newEmail(): string {
  const email = `payments.test.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@example.com`;
  emails.push(email);
  return email;
}

async function fillRegister(page: Page, email: string) {
  await page.getByLabel("Full name").fill("Payments Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
}

async function registerAndLand(page: Page, email: string) {
  await page.goto("/register");
  await fillRegister(page, email);
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: /^Settings$/ }).first().click();
  await expect(page.getByRole("heading", { name: "Your plan" })).toBeVisible();
}

test("a signed-out visitor who presses Buy is sent to create an account, then returned to checkout", async ({ page }) => {
  await page.route("**/api/checkout", async (route) => {
    // First call is the signed-out attempt; later calls come after sign-up.
    const signedIn = (await page.context().cookies()).some((c) => /session/i.test(c.name));
    if (!signedIn) {
      await route.fulfill({ status: 401, json: { error: "Sign in", code: "AUTHENTICATION_ERROR" } });
    } else {
      await route.fulfill({ status: 200, json: { url: FAKE_CHECKOUT } });
    }
  });
  await page.route("https://dusk-test.lemonsqueezy.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Fake checkout</title><h1>Fake Lemon Squeezy checkout</h1>" })
  );

  await page.goto("/#pricing");
  await page.getByRole("button", { name: "Get Dusk Lifetime" }).click();

  await expect(page).toHaveURL(/\/register\?next=checkout/);
  await expect(page.getByText("Create your account to buy lifetime access")).toBeVisible();
  // The intent survives a trip to the sign-in page and back.
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\?next=checkout/);
  await expect(page.getByText("Sign in to buy lifetime access")).toBeVisible();
  await page.getByRole("link", { name: "Create one" }).click();
  await expect(page).toHaveURL(/\/register\?next=checkout/);

  await fillRegister(page, newEmail());
  // Signed up: back on the checkout step, which now opens the payment page.
  await expect(page.getByRole("heading", { name: "Fake Lemon Squeezy checkout" })).toBeVisible({ timeout: 30_000 });
});

test("a ?next= value that is not 'checkout' never leaves the site (no open redirect)", async ({ page }) => {
  await page.goto("/register?next=https://evil.example/steal");
  await expect(page.getByText("Create your account to buy lifetime access")).toHaveCount(0);
  await fillRegister(page, newEmail());
  await expect(page).toHaveURL(/localhost:\d+\/dashboard/, { timeout: 30_000 });
});

test("when checkout cannot start, the landing page stays put, says so in an alert, and can retry", async ({ page }) => {
  const email = newEmail();
  await registerAndLand(page, email);
  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    if (calls < 3) await route.fulfill({ status: 502, json: { error: "x", code: "CHECKOUT_FAILED" } });
    else await route.fulfill({ status: 200, json: { url: FAKE_CHECKOUT } });
  });
  await page.route("https://dusk-test.lemonsqueezy.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Fake Lemon Squeezy checkout</h1>" })
  );

  await page.goto("/#pricing");
  const buy = page.getByRole("button", { name: "Get Dusk Lifetime" });
  await buy.click();

  const alert = page.getByRole("alert").filter({ hasText: ERROR_TEXT });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("[SUPPORT EMAIL TO BE ADDED]");
  await expect(page).not.toHaveURL(/register|login|lemonsqueezy/);

  await alert.getByRole("button", { name: "Try again" }).click(); // 2nd failure
  await expect(alert).toBeVisible();
  await alert.getByRole("button", { name: "Try again" }).click(); // 3rd call succeeds
  await expect(page.getByRole("heading", { name: "Fake Lemon Squeezy checkout" })).toBeVisible();
  expect(calls).toBe(3);
});

test("a network failure is handled the same way and a double-click sends one request", async ({ page }) => {
  await registerAndLand(page, newEmail());
  let calls = 0;
  await page.route("**/api/checkout", async (route) => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 600));
    await route.abort("failed");
  });
  await page.goto("/#pricing");
  const buy = page.getByRole("button", { name: "Get Dusk Lifetime" });
  await buy.dblclick();
  await expect(page.getByRole("alert").filter({ hasText: ERROR_TEXT })).toBeVisible();
  expect(calls).toBe(1);
  await expect(buy).toBeEnabled();
});

test("Settings shows the real plan: free with a Buy button, then Lifetime access with the date", async ({ page }) => {
  const email = newEmail();
  await registerAndLand(page, email);
  await openSettings(page);

  const plan = page.getByRole("region", { name: "Your plan" });
  await expect(plan.getByText("Free account")).toBeVisible();
  await expect(plan.getByText("Lifetime access", { exact: true })).toHaveCount(0);

  // Failure keeps the person in Settings.
  await page.route("**/api/checkout", (route) => route.fulfill({ status: 503, json: { error: "x", code: "PAYMENTS_UNAVAILABLE" } }));
  await plan.getByRole("button", { name: "Buy lifetime access" }).click();
  await expect(plan.getByRole("alert")).toContainText(ERROR_TEXT);
  await expect(page).toHaveURL(/\/dashboard/);
  await page.unroute("**/api/checkout");

  // The purchase arrives (as the webhook would record it).
  const purchasedAt = new Date("2026-03-04T10:00:00Z");
  await db.user.update({ where: { email }, data: { hasLifetimeAccess: true, lifetimePurchasedAt: purchasedAt } });
  await page.reload();
  await openSettings(page);
  const paid = page.getByRole("region", { name: "Your plan" });
  await expect(paid.getByText("Lifetime access", { exact: true })).toBeVisible();
  await expect(paid.getByText("Mar 4, 2026")).toBeVisible();
  await expect(paid.getByRole("button", { name: "Buy lifetime access" })).toHaveCount(0);
  await expect(paid.getByText("Free account")).toHaveCount(0);
});

test("coming back from the payment page explains the wait and shows access once it lands", async ({ page }) => {
  const email = newEmail();
  await registerAndLand(page, email);
  await page.goto("/dashboard?checkout=success");
  await expect(page.getByText(/confirming your payment/i)).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveURL(/checkout=success/); // the flag is removed so a refresh stays quiet

  await db.user.update({ where: { email }, data: { hasLifetimeAccess: true, lifetimePurchasedAt: new Date() } });
  await expect(page.getByText("Payment received. Your lifetime access is active.")).toBeVisible({ timeout: 20_000 });
});
