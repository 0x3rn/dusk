// tests/e2e/auth-password-layout.spec.ts
// Layout checks for the password pages at phone, tablet and desktop widths in light and dark themes:
// no sideways scrolling, and every control that belongs to the password flow is at least 44px tall.
// Screenshots are saved in the test output folder for a human to look at.
import { expect, test, type Locator, type Page } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;
const THEMES = ["light", "dark"] as const;
const MIN_TARGET = 44;

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(0);
}

async function expectTapTargets(scope: Locator) {
  const targets = scope.locator("button:visible, a:visible, input:visible");
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await targets.nth(i).boundingBox();
    const label = await targets.nth(i).evaluate((el) => el.outerHTML.slice(0, 120));
    expect(box?.height ?? 0, `height of ${label}`).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
    expect(box?.width ?? 0, `width of ${label}`).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
  }
}

async function ready(page: Page, url: string, theme: string) {
  await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);
  await page.goto(url);
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return !!form && Object.keys(form).some((key) => key.startsWith("__reactProps"));
  });
}

for (const theme of THEMES) {
  for (const width of WIDTHS) {
    test.describe(`${theme} theme at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: theme });

      test("sign-in page keeps the forgot-password link usable", async ({ page }, testInfo) => {
        await ready(page, "/login", theme);
        await noSidewaysScroll(page);
        const link = page.getByRole("link", { name: "Forgot password?" });
        await expect(link).toBeVisible();
        expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
        await page.screenshot({ path: testInfo.outputPath(`login-${theme}-${width}.png`), fullPage: true });
      });

      test("forgot-password page, both steps", async ({ page }, testInfo) => {
        await ready(page, "/forgot-password", theme);
        await noSidewaysScroll(page);
        await expectTapTargets(page.locator("main form"));
        await page.screenshot({ path: testInfo.outputPath(`forgot-1-${theme}-${width}.png`), fullPage: true });

        await page.getByLabel("Email").fill(`auth.test.layout.${width}.${theme}@example.com`);
        await page.getByRole("button", { name: "Send me a code" }).click();
        await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
        // Show the error states too, because they change the height of the form.
        await page.getByRole("button", { name: "Change password" }).click();
        await expect(page.getByText("Enter a new password.")).toBeVisible();
        await noSidewaysScroll(page);
        await expectTapTargets(page.locator("main form"));
        await page.screenshot({ path: testInfo.outputPath(`forgot-2-${theme}-${width}.png`), fullPage: true });
      });
    });
  }
}

test.describe("settings change-password card", () => {
  const email = `auth.test.layout.${Date.now()}@example.com`;

  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      test(`${theme} theme at ${width}px`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript((value) => window.localStorage.setItem("theme", value), theme);

        await page.goto("/register");
        await page.waitForFunction(() => {
          const form = document.querySelector("form");
          return !!form && Object.keys(form).some((key) => key.startsWith("__reactProps"));
        });
        await page.getByLabel("Full name").fill("Layout Test");
        await page.getByLabel("Email").fill(email.replace("@", `.${theme}${width}@`));
        await page.getByLabel("Password", { exact: true }).fill("Layout-test-password-1");
        await page.getByRole("button", { name: "Create account" }).click();
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

        // Below the desktop width the navigation lives in a menu.
        const menu = page.getByRole("button", { name: "Open navigation menu" });
        const settingsLink = page.getByRole("button", { name: "Settings" }).first();
        await expect(menu.or(settingsLink).first()).toBeVisible();
        if (await menu.isVisible()) await menu.click();
        await settingsLink.click();
        const card = page.locator("#change-password");
        await expect(card).toBeVisible();
        await noSidewaysScroll(page);
        await page.screenshot({ path: testInfo.outputPath(`settings-1-${theme}-${width}.png`), fullPage: true });

        await card.getByRole("button", { name: "Email me a code" }).click();
        await expect(card.getByLabel("6-digit code")).toBeVisible();
        await card.getByRole("button", { name: "Change password" }).click();
        await expect(card.getByText("Enter a new password.")).toBeVisible();
        await noSidewaysScroll(page);
        await expectTapTargets(card);
        await card.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`settings-2-${theme}-${width}.png`), fullPage: true });
      });
    }
  }
});
