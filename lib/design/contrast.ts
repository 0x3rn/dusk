// lib/design/contrast.ts
// WCAG 2.x contrast maths and a reader for the colour tokens in app/globals.css, so the theme's
// accessibility is checked by a test instead of by eye.

export type Theme = "light" | "dark";
export type Tokens = Record<string, string>;

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a #RRGGBB colour (WCAG definition). */
export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a #RRGGBB colour: "${hex}"`);
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Contrast ratio between two colours, from 1 (identical) to 21 (black on white). */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function blockBody(css: string, selector: RegExp): string {
  const match = selector.exec(css);
  if (!match) throw new Error(`Selector not found in CSS: ${selector}`);
  const start = css.indexOf("{", match.index) + 1;
  let depth = 1;
  let i = start;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return css.slice(start, i - 1);
}

function readDeclarations(body: string): Tokens {
  const tokens: Tokens = {};
  const pattern = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
  for (let m = pattern.exec(body); m; m = pattern.exec(body)) tokens[m[1]] = m[2].replace(/\/\*.*?\*\//g, "").trim();
  return tokens;
}

/** Reads the light (`:root`) and dark (`.dark`) colour tokens from globals.css text. */
export function readThemeTokens(css: string): Record<Theme, Tokens> {
  return {
    light: readDeclarations(blockBody(css, /^:root\s*\{/m)),
    dark: readDeclarations(blockBody(css, /^\.dark,\s*\n?\[data-theme="dark"\]\s*\{/m)),
  };
}
