// trigger/dead-mans-switch.ts
// Trigger.dev durable schedule: every 15 minutes, ask the app to run one scheduler sweep.
// The sweep itself is idempotent and single-flight, so Trigger.dev retries and overlapping runs
// are safe. Set APP_URL and CRON_SECRET in the Trigger.dev project's environment variables.
import { AbortTaskRunError, schedules } from "@trigger.dev/sdk";
import { TickFailedError, callSchedulerTick } from "../lib/engine/tick-client";

export const deadMansSwitchTick = schedules.task({
  id: "dusk-dead-mans-switch-tick",
  cron: "*/15 * * * *",
  maxDuration: 300,
  retry: { maxAttempts: 3, factor: 2, minTimeoutInMs: 5_000, maxTimeoutInMs: 60_000 },
  run: async () => {
    try {
      const result = await callSchedulerTick({
        appUrl: process.env.APP_URL ?? "",
        cronSecret: process.env.CRON_SECRET ?? "",
      });
      if (result.errors && result.errors > 0) {
        // Some estates failed inside an otherwise successful sweep: surface it in Trigger.dev.
        console.error(`Scheduler sweep finished with ${result.errors} estate error(s).`);
      }
      return result;
    } catch (err) {
      if (err instanceof TickFailedError && !err.retryable) {
        // Wrong secret or missing configuration: retrying will not help.
        throw new AbortTaskRunError(err.message);
      }
      throw err;
    }
  },
});
