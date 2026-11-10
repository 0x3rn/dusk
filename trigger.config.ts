// trigger.config.ts
// Trigger.dev project settings. TRIGGER_PROJECT_REF is the "proj_..." id from the Trigger.dev
// dashboard (Project settings). Deploy with: npx trigger.dev@latest deploy
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_TRIGGER_PROJECT_REF",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 },
  },
});
