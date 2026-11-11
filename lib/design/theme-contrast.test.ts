// lib/design/theme-contrast.test.ts
// Fails when a colour pairing in app/globals.css drops below the WCAG contrast we promise:
// 4.5:1 for text, 3:1 for the parts of a control that must be seen (borders, rings, indicators).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, readThemeTokens, type Theme } from "./contrast";

const css = readFileSync(path.resolve(import.meta.dirname, "../../app/globals.css"), "utf8");
const tokens = readThemeTokens(css);

const TEXT = 4.5;
const UI = 3;

// [foreground token, background token, minimum ratio, what it is]
const PAIRS: Array<[string, string, number, string]> = [
  // Body and secondary text on every surface
  ...["background", "card", "popover", "canvas", "elevated", "sunken", "secondary", "muted", "hover"].map(
    (bg): [string, string, number, string] => ["foreground", bg, 7, "body text"]
  ),
  ...["background", "card", "canvas", "elevated", "sunken", "muted", "hover"].map(
    (bg): [string, string, number, string] => ["foreground-secondary", bg, TEXT, "secondary text"]
  ),
  ...["background", "card", "canvas", "elevated", "sunken", "muted", "hover"].map(
    (bg): [string, string, number, string] => ["foreground-muted", bg, TEXT, "muted text"]
  ),
  ...["background", "card", "muted", "secondary"].map(
    (bg): [string, string, number, string] => ["muted-foreground", bg, TEXT, "muted text (shadcn)"]
  ),
  // Brand: text on the brand fill, brand text on surfaces, brand lines against surfaces
  ["on-brand", "brand", TEXT, "button label on brand"],
  ["on-brand", "brand-hover", TEXT, "button label on hovered brand"],
  ["primary-foreground", "primary", TEXT, "shadcn primary button label"],
  ...["background", "card", "elevated", "accent-surface", "canvas"].map(
    (bg): [string, string, number, string] => ["accent-text", bg, TEXT, "green text"]
  ),
  ["accent-foreground", "accent", TEXT, "text on accent"],
  ...["background", "card", "canvas", "elevated"].map(
    (bg): [string, string, number, string] => ["brand", bg, UI, "brand lines, icons and indicators"]
  ),
  ...["background", "card", "canvas", "elevated"].map(
    (bg): [string, string, number, string] => ["ring", bg, UI, "focus ring"]
  ),
  // The edge of a text field must be visible on its own (WCAG 1.4.11)
  ...["background", "card", "canvas", "elevated"].map(
    (bg): [string, string, number, string] => ["input", bg, UI, "form field border"]
  ),
  // Status colours
  ["success-fg", "success-bg", TEXT, "success text"],
  ["warning-fg", "warning-bg", TEXT, "warning text"],
  ["danger-fg", "danger-bg", TEXT, "danger text"],
  ["info-fg", "info-bg", TEXT, "info text"],
  ["destructive", "background", TEXT, "destructive text"],
  ["destructive", "card", TEXT, "destructive text on card"],
  ["destructive-foreground", "destructive", TEXT, "destructive button label"],
  // Dark call-to-action band
  ["cta-band-text", "cta-band", 7, "call-to-action text"],
  ["cta-band-text-secondary", "cta-band", TEXT, "call-to-action secondary text"],
];

describe.each(["light", "dark"] as Theme[])("%s theme contrast", (theme) => {
  const t = tokens[theme];
  it.each(PAIRS)("%s on %s is at least %s:1 (%s)", (fg, bg, min) => {
    expect(t[fg], `--${fg} is missing from the ${theme} theme`).toBeDefined();
    expect(t[bg], `--${bg} is missing from the ${theme} theme`).toBeDefined();
    const ratio = contrast(t[fg], t[bg]);
    expect(ratio, `${fg} ${t[fg]} on ${bg} ${t[bg]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});

describe("the dark theme is its own design", () => {
  it("avoids pure black and pure white fields", () => {
    for (const token of ["background", "card", "canvas", "elevated", "sunken"]) {
      expect(tokens.dark[token].toUpperCase()).not.toBe("#000000");
      expect(tokens.dark[token].toUpperCase()).not.toBe("#FFFFFF");
    }
  });
});

describe("contrast helper", () => {
  it("matches known values", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrast("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrast("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });
  it("rejects values that are not #RRGGBB", () => {
    expect(() => contrast("red", "#FFFFFF")).toThrow(/#RRGGBB/);
  });
});
