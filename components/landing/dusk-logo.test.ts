// components/landing/dusk-logo.test.ts
// The Dusk symbol must always be drawn in the normal ink colour (text-foreground): near-black in
// light mode, near-white in dark mode, with only the centre dot in brand mint. Tinting the whole
// symbol with the accent colour turned the "D" green in light mode and made it all one green
// (hiding the dot) in dark mode.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === ".next") return [];
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(tsx|ts)$/.test(name) ? [full] : [];
  });
}

describe("DuskSymbol colour", () => {
  const root = process.cwd();
  const files = [...sourceFiles(path.join(root, "app")), ...sourceFiles(path.join(root, "components"))].filter(
    (f) => !f.endsWith("dusk-logo.test.ts")
  );

  it("is never given an accent, brand or muted colour class", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/<DuskSymbol[^>]*>/g)) {
        if (/text-(accent|brand|primary|muted|foreground-secondary|foreground-muted)/.test(match[0])) {
          offenders.push(`${path.relative(root, file)}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the centre dot on the brand token and the shape on currentColor", () => {
    const logo = readFileSync(path.join(root, "components/landing/dusk-logo.tsx"), "utf8");
    expect(logo).toMatch(/<circle[^>]*fill="var\(--brand\)"/);
    expect(logo.match(/fill="currentColor"/g)?.length).toBe(2);
  });
});
