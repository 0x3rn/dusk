// scripts/bundled-env-guard.mjs
// OpenNext copies every value from .env and .env.local into the Worker bundle as plain text
// (.open-next/cloudflare/next-env.mjs). That is fine for a local preview, but a bundle built on a
// machine with real secrets in those files must never be uploaded. This finds such values.
// Only NEXT_PUBLIC_* values are allowed, because Next puts those in the browser bundle anyway.

/** Returns the names ("production.DATABASE_URL") of non-public, non-empty values in the bundle file. */
export function findBundledSecrets(source) {
  const found = [];
  const pattern = /export const (\w+) = (\{.*?\});/gs;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let values;
    try {
      values = JSON.parse(match[2]);
    } catch {
      throw new Error(`Could not read the "${match[1]}" values in next-env.mjs, so the build cannot be checked.`);
    }
    for (const [key, value] of Object.entries(values)) {
      if (!key.startsWith("NEXT_PUBLIC_") && typeof value === "string" && value.length > 0) {
        found.push(`${match[1]}.${key}`);
      }
    }
  }
  return found;
}
