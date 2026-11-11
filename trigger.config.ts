// trigger.config.ts
// Trigger.dev project settings. The project id (TRIGGER_PROJECT_REF, "proj_...") is not a secret.
// Deploy with:  npx trigger.dev@latest deploy --env prod --env-file <file with the three values>
// The deploy reads APP_URL and CRON_SECRET from that environment and syncs them into the
// Trigger.dev project, so nothing secret is stored in this repository.
import { defineConfig } from "@trigger.dev/sdk";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_REF ?? "proj_set_TRIGGER_PROJECT_REF",
  dirs: ["./trigger"],
  maxDuration: 300,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 },
  },
  build: {
    extensions: [
      syncEnvVars(async () => {
        const vars: Array<{ name: string; value: string }> = [];
        const appUrl = process.env.APP_URL;
        const cronSecret = process.env.CRON_SECRET;
        if (appUrl) vars.push({ name: "APP_URL", value: appUrl });
        if (cronSecret) vars.push({ name: "CRON_SECRET", value: cronSecret });
        return vars;
      }),
    ],
  },
});
