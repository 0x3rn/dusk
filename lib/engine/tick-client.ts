// lib/engine/tick-client.ts
// What the durable scheduler (Trigger.dev) does every run: call our tick endpoint with the shared
// secret. Kept separate and tiny so it can be tested without Trigger.dev.

export interface TickResult {
  ok: boolean;
  skipped?: boolean;
  examined?: number;
  errors?: number;
  [key: string]: unknown;
}

export class TickFailedError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = "TickFailedError";
  }
}

export async function callSchedulerTick(params: {
  appUrl: string;
  cronSecret: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}): Promise<TickResult> {
  if (!params.appUrl || !params.cronSecret) {
    // Permanent: retrying cannot fix missing configuration.
    throw new TickFailedError("APP_URL and CRON_SECRET must be set for the scheduler.", false);
  }
  const doFetch = params.fetchImpl ?? ((url, init) => fetch(url, init));

  let res: Response;
  try {
    res = await doFetch(`${params.appUrl.replace(/\/$/, "")}/api/internal/scheduler/tick`, {
      method: "POST",
      headers: { Authorization: `Bearer ${params.cronSecret}` },
      signal: AbortSignal.timeout(params.timeoutMs ?? 290_000),
    });
  } catch (err) {
    throw new TickFailedError(
      `Could not reach the tick endpoint: ${err instanceof Error ? err.name : "unknown error"}`,
      true
    );
  }

  if (!res.ok) {
    // 401/503 mean configuration is wrong (permanent); 5xx/429 may pass on retry.
    const retryable = res.status === 429 || res.status >= 500;
    throw new TickFailedError(`Tick endpoint responded ${res.status}.`, retryable && res.status !== 503);
  }
  return (await res.json()) as TickResult;
}
