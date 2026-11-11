// components/theme-menu-item.test.ts
// The theme choice lives in menus and footers. These checks fail if the old lone sun/moon button
// comes back into a top bar. The browser test in tests/e2e/theme-menu.spec.ts covers real behaviour.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|mdx?)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

describe("theme control placement", () => {
  it("no longer has a standalone toggle component", () => {
    expect(existsSync(path.join(ROOT, "components/theme-toggle.tsx"))).toBe(false);
  });

  it("is not imported or rendered as ThemeToggle anywhere in app, components or lib", () => {
    const offenders = ["app", "components", "lib"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) => /ThemeToggle|theme-toggle/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it("is used in the dashboard sidebar and drawer, the home page menu and the footer", () => {
    const dashboard = read("components/dashboard/dashboard-shell.tsx");
    expect(dashboard.match(/<ThemeMenuItem/g)?.length).toBe(2);
    expect(read("components/landing/site-header.tsx")).toContain("<ThemeMenuItem");
    expect(read("components/landing/site-footer.tsx")).toContain("<ThemeMenuItem");
  });

  it("is reachable from every public page through the footer", () => {
    expect(read("components/marketing/site-doc-shell.tsx")).toContain("<SiteFooter");
    expect(read("app/recovery/page.tsx")).toContain("<SiteFooter");
    expect(read("app/(marketing)/security/page.tsx")).toContain("<SiteFooter");
    expect(read("app/(marketing)/marketing-landing.tsx")).toContain("<SiteFooter");
  });

  it("keeps next-themes configured to set both class and data-theme without a flash", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain('attribute={["class", "data-theme"]}');
    expect(layout).toContain("suppressHydrationWarning");
  });
});
