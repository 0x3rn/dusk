// lib/billing/lemonsqueezy-checkout.ts
// Creates a Lemon Squeezy hosted checkout for the lifetime-access variant. Plain fetch, no SDK.
// Everything that identifies the buyer (user id, email, name) is set here on the server from the
// signed-in user; nothing from the browser request reaches Lemon Squeezy.
import { z } from "zod";

export const LEMONSQUEEZY_CHECKOUTS_URL = "https://api.lemonsqueezy.com/v1/checkouts";
export const CHECKOUT_TIMEOUT_MS = 10_000;

export interface LemonSqueezyEnvInput {
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_VARIANT_ID?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
}

export interface CheckoutConfig {
  apiKey: string;
  storeId: string;
  variantId: string;
}

export interface WebhookConfig {
  webhookSecret: string;
  storeId: string;
  variantId: string;
}

/** Thrown when payments settings are missing or malformed. Names variables, never values. */
export class PaymentsNotConfiguredError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Payments are not configured: ${problems.join(", ")}.`);
    this.name = "PaymentsNotConfiguredError";
  }
}

const NUMERIC_ID = /^\d{1,20}$/;

function idProblems(env: LemonSqueezyEnvInput): { storeId?: string; variantId?: string; problems: string[] } {
  const problems: string[] = [];
  const storeId = env.LEMONSQUEEZY_STORE_ID?.trim();
  const variantId = env.LEMONSQUEEZY_VARIANT_ID?.trim();
  if (!storeId) problems.push("LEMONSQUEEZY_STORE_ID is missing");
  else if (!NUMERIC_ID.test(storeId)) problems.push("LEMONSQUEEZY_STORE_ID must be a number");
  if (!variantId) problems.push("LEMONSQUEEZY_VARIANT_ID is missing");
  else if (!NUMERIC_ID.test(variantId)) problems.push("LEMONSQUEEZY_VARIANT_ID must be a number");
  return { storeId, variantId, problems };
}

export function readCheckoutConfig(env: LemonSqueezyEnvInput): CheckoutConfig {
  const { storeId, variantId, problems } = idProblems(env);
  const apiKey = env.LEMONSQUEEZY_API_KEY?.trim();
  if (!apiKey) problems.push("LEMONSQUEEZY_API_KEY is missing");
  if (problems.length > 0 || !apiKey || !storeId || !variantId) {
    throw new PaymentsNotConfiguredError(problems);
  }
  return { apiKey, storeId, variantId };
}

export function readWebhookConfig(env: LemonSqueezyEnvInput): WebhookConfig {
  const { storeId, variantId, problems } = idProblems(env);
  const webhookSecret = env.LEMONSQUEEZY_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) problems.push("LEMONSQUEEZY_WEBHOOK_SECRET is missing");
  if (problems.length > 0 || !webhookSecret || !storeId || !variantId) {
    throw new PaymentsNotConfiguredError(problems);
  }
  return { webhookSecret, storeId, variantId };
}

export type CheckoutFailureKind =
  | "timeout"
  | "network"
  | "auth"
  | "rejected"
  | "rate_limited"
  | "provider_unavailable"
  | "bad_response";

/** Lemon Squeezy could not give us a checkout. `retryable` says whether trying again can help. */
export class CheckoutProviderError extends Error {
  public readonly retryable: boolean;
  constructor(
    public readonly kind: CheckoutFailureKind,
    public readonly providerStatus: number | null,
    public readonly detail?: string
  ) {
    super(`Lemon Squeezy checkout failed (${kind}${providerStatus ? `, HTTP ${providerStatus}` : ""}).`);
    this.name = "CheckoutProviderError";
    this.retryable = kind !== "auth" && kind !== "rejected";
  }
}

export interface LifetimeCheckoutInput {
  userId: string;
  email: string;
  fullName: string | null;
  appUrl: string;
  config: CheckoutConfig;
}

export interface CheckoutRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildLifetimeCheckoutRequest(input: LifetimeCheckoutInput): CheckoutRequest {
  const base = input.appUrl.replace(/\/+$/, "");
  const name = input.fullName?.trim().slice(0, 200);
  const body = {
    data: {
      type: "checkouts",
      attributes: {
        product_options: {
          redirect_url: `${base}/dashboard?checkout=success`,
        },
        checkout_data: {
          email: input.email,
          ...(name ? { name } : {}),
          // Comes back to us in the webhook as meta.custom_data.user_id.
          custom: { user_id: input.userId },
        },
      },
      relationships: {
        store: { data: { type: "stores", id: input.config.storeId } },
        variant: { data: { type: "variants", id: input.config.variantId } },
      },
    },
  };
  return {
    url: LEMONSQUEEZY_CHECKOUTS_URL,
    method: "POST",
    headers: {
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: `Bearer ${input.config.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

const CheckoutResponseSchema = z.object({
  data: z.object({ attributes: z.object({ url: z.string().min(1) }) }),
});

const ProviderErrorSchema = z.object({
  errors: z.array(z.object({ title: z.string().optional(), detail: z.string().optional() })).min(1),
});

/** The checkout link must be a Lemon Squeezy page; refuse anything else instead of redirecting a user to it. */
export function isLemonSqueezyCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "lemonsqueezy.com" || url.hostname.endsWith(".lemonsqueezy.com"))
    );
  } catch {
    return false;
  }
}

function failureKindForStatus(status: number): CheckoutFailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "rejected";
  return "bad_response";
}

async function providerDetail(res: Response): Promise<string | undefined> {
  try {
    const parsed = ProviderErrorSchema.safeParse(await res.json());
    if (!parsed.success) return undefined;
    const first = parsed.data.errors[0];
    return [first.title, first.detail].filter(Boolean).join(": ").slice(0, 300);
  } catch {
    return undefined;
  }
}

export interface CheckoutDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Creates the checkout and returns its hosted URL. Throws CheckoutProviderError on any failure. */
export async function createLifetimeCheckout(
  input: LifetimeCheckoutInput,
  deps: CheckoutDeps = {}
): Promise<{ url: string }> {
  const request = buildLifetimeCheckoutRequest(input);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? CHECKOUT_TIMEOUT_MS;

  // One timer covers the whole exchange, including reading the response body.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
        cache: "no-store",
      });
    } catch (err) {
      if (controller.signal.aborted) throw new CheckoutProviderError("timeout", null);
      throw new CheckoutProviderError("network", null, err instanceof Error ? err.name : undefined);
    }

    if (!res.ok) {
      throw new CheckoutProviderError(failureKindForStatus(res.status), res.status, await providerDetail(res));
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      if (controller.signal.aborted) throw new CheckoutProviderError("timeout", res.status);
      throw new CheckoutProviderError("bad_response", res.status, "Response was not JSON");
    }
    const parsed = CheckoutResponseSchema.safeParse(json);
    if (!parsed.success || !isLemonSqueezyCheckoutUrl(parsed.data.data.attributes.url)) {
      throw new CheckoutProviderError("bad_response", res.status, "No usable checkout URL in response");
    }
    return { url: parsed.data.data.attributes.url };
  } finally {
    clearTimeout(timer);
  }
}
