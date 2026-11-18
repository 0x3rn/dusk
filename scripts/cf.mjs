// scripts/cf.mjs
// Runs the OpenNext Cloudflare commands (build, preview, deploy), adding the Windows symlink shim
// on Windows and refusing to deploy a build that carries secrets.
// Usage: node scripts/cf.mjs build | preview [-- wrangler args] | deploy
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBundledSecrets } from "./bundled-env-guard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
if (process.platform === "win32") {
  // NODE_OPTIONS treats backslashes as escapes, so the path is passed with forward slashes.
  const shim = path.join(here, "windows-symlink-shim.cjs").replaceAll("\\", "/");
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require "${shim}"`.trim();
}

// A deploy must never upload a bundle that carries secrets copied from local .env files.
if (process.argv[2] === "deploy" || process.argv[2] === "upload") {
  const bundled = ".open-next/cloudflare/next-env.mjs";
  if (!existsSync(bundled)) {
    console.error("No build found. Run `npm run cf:build` first.");
    process.exit(1);
  }
  const secrets = findBundledSecrets(readFileSync(bundled, "utf8"));
  if (secrets.length > 0) {
    console.error(
      [
        "Refusing to deploy: this build has secret values copied from local .env files into the Worker:",
        ...secrets.map((name) => `  ${name}`),
        "Build from a clean checkout with no .env files (for example in CI), and set secrets with `wrangler secret put`.",
        "See docs/CLOUDFLARE.md.",
      ].join("\n")
    );
    process.exit(1);
  }
}

const result = spawnSync("npx", ["opennextjs-cloudflare", ...process.argv.slice(2)], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
