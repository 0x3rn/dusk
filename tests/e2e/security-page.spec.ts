// tests/e2e/security-page.spec.ts
// The public Security page is plain language first, with the exact methods under "Technical
// details". Checks the words, the layout at three widths in light and dark, and that the footer
// theme control still works.
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [375, 768, 1280] as const;
const THEMES = ["light", "dark"] as const;
const SHOTS = process.env.E2E_SHOTS_DIR;

const JARGON = [
  "GRACE_PERIOD",
  "ESCALATION_PENDING",
  "VERIFICATION_REQUIRED",
  "RELEASE_HOLD",
  "fail-closed",
  "fails closed",
  "AES-256",
  "ECDH",
  "P-256",
  "HKDF",
  "Argon2id",
  "PBKDF2",
  "SHA-256",
  "state machine",
  "KEK",
];

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.locator("footer").getByTestId("theme-menu-item").locator("label", { hasText: theme === "dark" ? "Dark" : "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

test("the plain part has no internal names or cipher names; they live under Technical details", async ({ page }) => {
  await page.goto("/security");
  await expect(page.getByRole("heading", { level: 1, name: "How Dusk keeps your vault private" })).toBeVisible();
  for (const heading of ["What is protected", "Who can see what", "What happens if you stop checking in", "What Dusk can't do", "Technical details"]) {
    await expect(page.getByRole("heading", { level: 2, name: heading })).toBeVisible();
  }

  const split = await page.evaluate(() => {
    const tech = document.getElementById("technical-details");
    const main = document.querySelector("main");
    if (!tech || !main) return null;
    const all = main.innerText;
    const technical = tech.innerText;
    return { plain: all.slice(0, all.length - technical.length), technical };
  });
  expect(split).not.toBeNull();
  for (const word of JARGON) {
    expect(split!.plain, `plain part should not say "${word}"`).not.toContain(word);
  }
  // The exact details are all still there, in the labelled section.
  for (const word of ["GRACE_PERIOD", "ESCALATION_PENDING", "VERIFICATION_REQUIRED", "AES-256-GCM", "ECDH P-256", "Argon2id", "PBKDF2-HMAC-SHA256", "upgrade themselves the next time they are unlocked"]) {
    expect(split!.technical, `technical part should mention "${word}"`).toContain(word);
  }
});

test("the on-page links jump to their sections", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/security");
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link", { name: "Technical details" }).click();
  await expect(page).toHaveURL(/#technical-details$/);
  await expect(page.getByRole("heading", { level: 2, name: "Technical details" })).toBeInViewport();
});

for (const width of WIDTHS) {
  for (const theme of THEMES) {
    test(`${width}px, ${theme}: no sideways scrolling, text fits, footer theme control works`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/security");
      await setTheme(page, theme);

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const wide: string[] = [];
        for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("main *, footer *"))) {
          const r = el.getBoundingClientRect();
          // Anything sticking out past the right edge, unless it scrolls inside its own box.
          if (r.right > window.innerWidth + 1 && r.width > 0) {
            let p: HTMLElement | null = el.parentElement;
            let contained = false;
            while (p && p !== document.body) {
              const ox = getComputedStyle(p).overflowX;
              if (ox === "auto" || ox === "scroll") {
                contained = true;
                break;
              }
              p = p.parentElement;
            }
            if (!contained) wide.push(`${el.tagName.toLowerCase()}.${el.className.toString().slice(0, 40)}`);
          }
        }
        return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, wide: wide.slice(0, 5) };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
      expect(layout.wide).toEqual([]);

      // Touch targets in the page's own link row are at least 44px tall.
      const heights = await page.getByRole("navigation", { name: "On this page" }).getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);

      // The footer control still switches the theme, and the page keeps fitting afterwards.
      const other = theme === "dark" ? "light" : "dark";
      await setTheme(page, other);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await setTheme(page, theme);

      if (SHOTS) await page.screenshot({ path: `${SHOTS}/security-${width}-${theme}.png`, fullPage: true });
    });
  }
}
