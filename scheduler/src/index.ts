// scheduler/src/index.ts
// Runs on a Cloudflare cron trigger. All it does is call the app's tick endpoint with the shared
// secret; the app does the real work (check-in reminders, releases, retention purge). The call
// itself lives in lib/engine/tick-client.ts so it is shared with, and tested like, the app code.
import { callSchedulerTick, TickFailedError } from "../../lib/engine/tick-client";

interface Env {
  APP_URL: string;
  CRON_SECRET: string;
}

const MAX_ATTEMPTS = 3;

async function runTick(env: Env): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await callSchedulerTick({ appUrl: env.APP_URL, cronSecret: env.CRON_SECRET });
      console.log(JSON.stringify({ event: "tick_ok", attempt, skipped: result.skipped ?? false, examined: result.examined ?? null, errors: result.errors ?? null }));
      return;
    } catch (err) {
      const retryable = err instanceof TickFailedError ? err.retryable : true;
      console.error(JSON.stringify({ event: "tick_failed", attempt, retryable, message: err instanceof Error ? err.message : "unknown" }));
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err; // shows as a failed run in Cloudflare
      await new Promise((resolve) => setTimeout(resolve, 5_000 * 2 ** (attempt - 1)));
    }
  }
}

const worker = {
  // Awaited (not waitUntil) so a failed tick shows up as a failed run in Cloudflare.
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await runTick(env);
  },
};

export default worker;
