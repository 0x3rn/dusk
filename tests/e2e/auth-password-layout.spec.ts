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

// On a computer (1024px and wider) the auth pages have no card and no side panel: the form is
// centred on the page. On phones and tablets the form keeps its card. Nothing else is on the page.
const AUTH_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
] as const;

for (const theme of THEMES) {
  for (const { width, height } of AUTH_VIEWPORTS) {
    for (const path of ["/login", "/register", "/forgot-password"]) {
      test.describe(`${path} layout, ${theme} theme at ${width}px`, () => {
        test.use({ viewport: { width, height }, colorScheme: theme });

        test("centred form, card only below 1024px, no side panel, button reachable", async ({ page }) => {
          await ready(page, path, theme);
          await noSidewaysScroll(page);

          const form = page.locator("main form");
          const formBox = await form.boundingBox();
          expect(formBox).not.toBeNull();
          const formWidth = formBox?.width ?? 0;
          const desktop = width >= 1024;

          if (width >= 768) {
            expect(formWidth, "form is too narrow").toBeGreaterThanOrEqual(380 - (desktop ? 0 : 64));
            expect(formWidth, "form is too wide to read comfortably").toBeLessThanOrEqual(480);
          } else {
            // On a phone the form uses the screen minus the 16px gutters, the 1px card border and 20px card padding.
            expect(formWidth, "form does not fill the phone width").toBeGreaterThanOrEqual(width - 76);
          }

          // The form is centred on the page.
          const centre = (formBox?.x ?? 0) + formWidth / 2;
          expect(Math.abs(centre - width / 2), "form is not centred").toBeLessThanOrEqual(2);

          // A card (border or shadow around the form) exists below 1024px and not above it.
          const framed = await form.evaluate((el) => {
            const main = el.closest("main");
            for (let node = el.parentElement; node && node !== main?.parentElement; node = node.parentElement) {
              const style = getComputedStyle(node);
              // "No shadow" can be computed as a fully transparent shadow, which is not a visible card.
              const visibleShadow = style.boxShadow !== "none" && !/^rgba\(0, 0, 0, 0\)/.test(style.boxShadow);
              if (parseFloat(style.borderTopWidth) > 0 || visibleShadow) return true;
            }
            return false;
          });
          expect(framed, desktop ? "form is wrapped in a card on desktop" : "form has lost its card on a phone or tablet").toBe(!desktop);

          // There is no extra section about what Dusk can see, at any width.
          await expect(page.getByRole("complementary")).toHaveCount(0);
          await expect(page.getByText("What Dusk can and can't see")).toHaveCount(0);

          // Text boxes use at least 16px so phones do not zoom in when one is tapped.
          const inputs = form.locator("input:visible");
          for (let i = 0; i < (await inputs.count()); i++) {
            const size = await inputs.nth(i).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
            expect(size).toBeGreaterThanOrEqual(16);
          }

          // The main button can be scrolled to and used.
          const submit = form.locator("button[type=submit]");
          await submit.scrollIntoViewIfNeeded();
          await expect(submit).toBeInViewport();
          expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
        });
      });
    }
  }
}
