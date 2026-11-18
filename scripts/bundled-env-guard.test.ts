// scripts/bundled-env-guard.test.ts
import { describe, expect, it } from "vitest";
import { findBundledSecrets } from "./bundled-env-guard.mjs";

const file = (production: object, development: object = {}) =>
  `export const production = ${JSON.stringify(production)};\nexport const development = ${JSON.stringify(development)};\nexport const test = {};\n`;

describe("findBundledSecrets", () => {
  it("passes a bundle that only has public values or nothing", () => {
    expect(findBundledSecrets(file({}))).toEqual([]);
    expect(findBundledSecrets(file({ NEXT_PUBLIC_APP_URL: "https://dusk.somto.xyz", NEXT_PUBLIC_SENTRY_DSN: "x" }))).toEqual([]);
  });

  it("names every secret in every environment, never its value", () => {
    const found = findBundledSecrets(file({ DATABASE_URL: "postgres://user:pw@host/db", NEXT_PUBLIC_APP_URL: "https://x" }, { CRON_SECRET: "abc" }));
    expect(found).toEqual(["production.DATABASE_URL", "development.CRON_SECRET"]);
    expect(JSON.stringify(found)).not.toContain("pw");
  });

  it("ignores empty values", () => {
    expect(findBundledSecrets(file({ RESEND_API_KEY: "" }))).toEqual([]);
  });

  it("refuses to guess when it cannot read the file", () => {
    expect(() => findBundledSecrets("export const production = {not json};")).toThrow(/cannot be checked/);
  });
});
