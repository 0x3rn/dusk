// tests/e2e/csp.spec.ts
// The per-request nonce Content-Security-Policy must not break any page: every page has to render
// and hydrate with zero CSP violations and zero console errors, and each response must carry a
// fresh nonce and no 'unsafe-inline' for scripts.
import { expect, test, type Page } from "@playwright/test";

const PUBLIC_PAGES = [
  "/",
  "/login",
  "/register",
  "/help",
  "/privacy",
  "/terms",
  "/security",
  "/security/disclosures",
  "/recovery",
  "/checkin/this-is-not-a-real-token-value",
  "/verify/this-is-not-a-real-token-value",
  "/unlock/this-is-not-a-real-contact-id",
];

interface Observed {
  violations: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

async function observe(page: Page): Promise<Observed> {
  const observed: Observed = { violations: [], consoleErrors: [], pageErrors: [] };
  // Registered before any page script runs, so early violations are not missed.
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      w.__cspViolations.push(`${event.violatedDirective} blocked ${event.blockedURI || "inline"} at ${event.sourceFile}:${event.lineNumber}`);
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error") observed.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observed.pageErrors.push(error.message));
  return observed;
}

async function collectViolations(page: Page, observed: Observed): Promise<void> {
  const fromPage = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? []);
  observed.violations.push(...fromPage);
}

function noiseFree(messages: string[]): string[] {
  // A deliberately invalid token makes the API answer 4xx, which the browser logs as a failed
  // resource load. That is expected on those pages and is not a policy problem.
  return messages.filter((m) => !/Failed to load resource: the server responded with a status of 4\d\d/.test(m));
}

for (const path of PUBLIC_PAGES) {
  test(`CSP: ${path} renders and hydrates with no violations`, async ({ page }) => {
    const observed = await observe(page);
    const response = await page.goto(path, { waitUntil: "networkidle" });
    expect(response, "response").not.toBeNull();
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("'strict-dynamic'");
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    // Hydration proof: the theme and scroll scripts ran, so <html> carries a theme class/attr.
    await expect(page.locator("html")).toHaveAttribute("data-theme", /light|dark/);

    await collectViolations(page, observed);
    expect(observed.violations).toEqual([]);
    expect(observed.pageErrors).toEqual([]);
    expect(noiseFree(observed.consoleErrors)).toEqual([]);
  });
}

test("CSP: every response carries a fresh nonce that matches the page's own scripts", async ({ request }) => {
  const nonces = new Set<string>();
  for (let i = 0; i < 5; i += 1) {
    const response = await request.get("/help");
    const csp = response.headers()["content-security-policy"] ?? "";
    const match = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp);
    expect(match, "nonce in header").not.toBeNull();
    const nonce = match?.[1] ?? "";
    nonces.add(nonce);

    const html = await response.text();
    const tags = html.match(/<script\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) expect(tag, "every script tag is nonced").toContain(`nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(5);
});

test("CSP: the dashboard still redirects signed-out visitors and hydrates for a signed-in person", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  const observed = await observe(page);
  const email = `hardening.csp.${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Full name").fill("CSP Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("A-long-test-passphrase-2026!");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  // Not "networkidle": the dev server keeps a hot-reload connection open for ever.
  await expect(page.getByRole("button", { name: "Digital vault" }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Digital vault" }).click();
  await expect(page.getByText("Create your master passphrase")).toBeVisible({ timeout: 30_000 });

  await collectViolations(page, observed);
  expect(observed.violations).toEqual([]);
  expect(observed.pageErrors).toEqual([]);
  expect(noiseFree(observed.consoleErrors)).toEqual([]);
});
