// tests/e2e/theme-menu.spec.ts
// The light/dark choice lives in menus and footers, never as a lone icon in a top bar.
// These run in a real browser, so they also prove the choice reaches <html> and survives a reload.
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_PAGES = ["/", "/help", "/privacy", "/terms", "/security", "/recovery"];

const control = (page: Page) => page.getByTestId("theme-menu-item");

async function choose(page: Page, label: "Light" | "Dark" | "System") {
  await control(page).locator("label", { hasText: label }).click();
}

async function htmlState(page: Page) {
  return page.evaluate(() => ({
    isDark: document.documentElement.classList.contains("dark"),
    dataTheme: document.documentElement.getAttribute("data-theme"),
    stored: window.localStorage.getItem("theme"),
  }));
}

for (const url of PUBLIC_PAGES) {
  test(`${url}: the top bar has no theme button, and the footer has the Appearance control`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(url);

    await expect(page.locator("header button, nav button").filter({ hasText: /theme|dark|light/i })).toHaveCount(0);
    await expect(page.locator("header [aria-label*='theme' i], nav [aria-label*='theme' i]")).toHaveCount(0);
    await expect(page.locator("header [data-testid='theme-menu-item'], nav [data-testid='theme-menu-item']")).toHaveCount(0);

    const footerControl = page.locator("footer").getByTestId("theme-menu-item");
    await expect(footerControl).toBeVisible();
    await expect(footerControl.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
  });
}

test("the footer control changes <html> to dark and light, and the choice survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/help");

  await choose(page, "Dark");
  expect(await htmlState(page)).toEqual({ isDark: true, dataTheme: "dark", stored: "dark" });
  await expect(control(page).getByRole("radio", { name: "Dark" })).toBeChecked();

  await page.reload();
  expect(await htmlState(page)).toEqual({ isDark: true, dataTheme: "dark", stored: "dark" });
  await expect(control(page).getByRole("radio", { name: "Dark" })).toBeChecked();

  await choose(page, "Light");
  expect(await htmlState(page)).toEqual({ isDark: false, dataTheme: "light", stored: "light" });
  await page.reload();
  expect(await htmlState(page)).toEqual({ isDark: false, dataTheme: "light", stored: "light" });
});

test("System follows the device setting", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/terms");
  // System is already the default, so clicking it on a fresh page changes (and stores) nothing.
  // Switch away first, then back, to prove choosing System explicitly works and is remembered.
  await choose(page, "Light");
  expect((await htmlState(page)).isDark).toBe(false);
  await choose(page, "System");
  expect((await htmlState(page)).isDark).toBe(true);
  expect((await htmlState(page)).stored).toBe("system");

  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await htmlState(page)).isDark).toBe(false);
});

test("the control works with the keyboard alone", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/privacy");
  await choose(page, "Light");

  await control(page).getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(control(page).getByRole("radio", { name: "Dark" })).toBeChecked();
  expect((await htmlState(page)).isDark).toBe(true);

  // The focus ring is drawn on the visible label next to the focused radio.
  const ring = await control(page)
    .locator("label", { hasText: "Dark" })
    .locator("span")
    .first()
    .evaluate((el) => getComputedStyle(el).boxShadow);
  expect(ring).not.toBe("none");
});

test("the options are at least 44px tall on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/help");
  for (const label of ["Light", "Dark", "System"]) {
    const box = await control(page).locator("label", { hasText: label }).boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("home page: no theme control in the closed top bar, but one inside the mobile menu", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.locator("header").getByTestId("theme-menu-item")).toHaveCount(0);
  await expect(page.locator("header button").filter({ hasText: /theme|dark|light/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Open menu" }).click();
  const menuControl = page.locator("header").getByTestId("theme-menu-item");
  await expect(menuControl).toBeVisible();
  await menuControl.locator("label", { hasText: "Dark" }).click();
  expect((await htmlState(page)).isDark).toBe(true);
  expect((await htmlState(page)).dataTheme).toBe("dark");
});

test("the signed-in dashboard has the control in the sidebar and in the phone drawer, not the top bar", async ({ page }) => {
  const email = `e2e.theme.${Date.now()}@example.com`;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/register");
  await page.getByLabel("Full name").fill("Theme Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("A-long-test-passphrase-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });

  // Desktop: sidebar only.
  await expect(page.locator("aside").getByTestId("theme-menu-item")).toBeVisible();
  await expect(page.locator("header").getByTestId("theme-menu-item")).toHaveCount(0);
  await expect(page.locator("header button").filter({ hasText: /theme|dark|light/i })).toHaveCount(0);
  await page.locator("aside").getByTestId("theme-menu-item").locator("label", { hasText: "Dark" }).click();
  expect((await htmlState(page)).isDark).toBe(true);

  // Phone: inside the navigation drawer.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  expect((await htmlState(page)).isDark).toBe(true);
  await expect(page.locator("header").getByTestId("theme-menu-item")).toHaveCount(0);
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const drawerControl = page.getByRole("dialog", { name: "Navigation menu" }).getByTestId("theme-menu-item");
  await expect(drawerControl).toBeVisible();
  await drawerControl.locator("label", { hasText: "Light" }).click();
  expect(await htmlState(page)).toEqual({ isDark: false, dataTheme: "light", stored: "light" });
});
