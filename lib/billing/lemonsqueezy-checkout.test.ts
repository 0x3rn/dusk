// lib/billing/lemonsqueezy-checkout.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  CheckoutProviderError,
  PaymentsNotConfiguredError,
  buildLifetimeCheckoutRequest,
  createLifetimeCheckout,
  isLemonSqueezyCheckoutUrl,
  readCheckoutConfig,
  readWebhookConfig,
  type LifetimeCheckoutInput,
} from "./lemonsqueezy-checkout";

const input: LifetimeCheckoutInput = {
  userId: "usr_abc",
  email: "buyer@example.com",
  fullName: "  Ada Buyer ",
  appUrl: "https://dusk.example/",
  config: { apiKey: "key_secret_value", storeId: "111", variantId: "222" },
};
const GOOD_URL = "https://dusk.lemonsqueezy.com/checkout/custom/abc?signature=xyz";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/vnd.api+json" },
  });
}
const okBody = { data: { type: "checkouts", id: "c1", attributes: { url: GOOD_URL } } };

async function failureOf(promise: Promise<unknown>): Promise<CheckoutProviderError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(CheckoutProviderError);
  return err as CheckoutProviderError;
}

describe("readCheckoutConfig / readWebhookConfig", () => {
  const full = {
    LEMONSQUEEZY_API_KEY: "k",
    LEMONSQUEEZY_STORE_ID: "111",
    LEMONSQUEEZY_VARIANT_ID: "222",
    LEMONSQUEEZY_WEBHOOK_SECRET: "s",
  };

  it("returns what each purpose needs", () => {
    expect(readCheckoutConfig(full)).toEqual({ apiKey: "k", storeId: "111", variantId: "222" });
    expect(readWebhookConfig(full)).toEqual({ webhookSecret: "s", storeId: "111", variantId: "222" });
  });

  it("names every missing variable and never includes a value", () => {
    let caught: unknown;
    try {
      readCheckoutConfig({ LEMONSQUEEZY_API_KEY: "topsecret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentsNotConfiguredError);
    const message = (caught as Error).message;
    expect(message).toContain("LEMONSQUEEZY_STORE_ID is missing");
    expect(message).toContain("LEMONSQUEEZY_VARIANT_ID is missing");
    expect(message).not.toContain("topsecret");
  });

  it("needs the webhook secret for the webhook but not the API key, and vice versa", () => {
    const noSecret = { ...full, LEMONSQUEEZY_WEBHOOK_SECRET: undefined };
    expect(() => readWebhookConfig(noSecret)).toThrow(/WEBHOOK_SECRET/);
    expect(readCheckoutConfig(noSecret).apiKey).toBe("k");
    const noKey = { ...full, LEMONSQUEEZY_API_KEY: undefined };
    expect(() => readCheckoutConfig(noKey)).toThrow(/API_KEY/);
    expect(readWebhookConfig(noKey).webhookSecret).toBe("s");
  });

  it("rejects non-numeric ids and blank values", () => {
    expect(() => readCheckoutConfig({ ...full, LEMONSQUEEZY_STORE_ID: "abc" })).toThrow(/STORE_ID must be a number/);
    expect(() => readCheckoutConfig({ ...full, LEMONSQUEEZY_VARIANT_ID: "  " })).toThrow(/VARIANT_ID is missing/);
  });
});

describe("buildLifetimeCheckoutRequest", () => {
  const req = buildLifetimeCheckoutRequest(input);
  const body = JSON.parse(req.body);

  it("posts to the checkouts endpoint with JSON:API headers and a Bearer key", () => {
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    expect(req.headers).toEqual({
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
      Authorization: "Bearer key_secret_value",
    });
  });

  it("sets user id, email and name on the server and sends them as checkout data", () => {
    expect(body.data.type).toBe("checkouts");
    expect(body.data.attributes.checkout_data).toEqual({
      email: "buyer@example.com",
      name: "Ada Buyer",
      custom: { user_id: "usr_abc" },
    });
  });

  it("points at our store and variant and returns to the dashboard afterwards", () => {
    expect(body.data.relationships).toEqual({
      store: { data: { type: "stores", id: "111" } },
      variant: { data: { type: "variants", id: "222" } },
    });
    expect(body.data.attributes.product_options.redirect_url).toBe("https://dusk.example/dashboard?checkout=success");
  });

  it("omits the name when there is none and never puts the API key in the body", () => {
    const noName = buildLifetimeCheckoutRequest({ ...input, fullName: null });
    expect(JSON.parse(noName.body).data.attributes.checkout_data).not.toHaveProperty("name");
    expect(req.body).not.toContain("key_secret_value");
  });
});

describe("isLemonSqueezyCheckoutUrl", () => {
  it("accepts https Lemon Squeezy pages only", () => {
    expect(isLemonSqueezyCheckoutUrl(GOOD_URL)).toBe(true);
    expect(isLemonSqueezyCheckoutUrl("http://dusk.lemonsqueezy.com/x")).toBe(false);
    expect(isLemonSqueezyCheckoutUrl("https://lemonsqueezy.com.evil.example/x")).toBe(false);
    expect(isLemonSqueezyCheckoutUrl("https://evil-lemonsqueezy.com/x")).toBe(false);
    expect(isLemonSqueezyCheckoutUrl("javascript:alert(1)")).toBe(false);
    expect(isLemonSqueezyCheckoutUrl("not a url")).toBe(false);
  });
});

describe("createLifetimeCheckout", () => {
  it("returns the hosted checkout URL and sends exactly the built request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, okBody));
    const out = await createLifetimeCheckout(input, { fetchImpl });
    expect(out).toEqual({ url: GOOD_URL });
    const [url, init] = fetchImpl.mock.calls[0];
    const built = buildLifetimeCheckoutRequest(input);
    expect(url).toBe(built.url);
    expect(init.body).toBe(built.body);
    expect(init.headers).toEqual(built.headers);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, "auth", false],
    [403, "auth", false],
    [422, "rejected", false],
    [404, "rejected", false],
    [429, "rate_limited", true],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
  ])("maps HTTP %i to %s (retryable: %s)", async (status, kind, retryable) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(status, { errors: [{ title: "Nope", detail: "Because." }] }));
    const failure = await failureOf(createLifetimeCheckout(input, { fetchImpl }));
    expect(failure.kind).toBe(kind);
    expect(failure.providerStatus).toBe(status);
    expect(failure.retryable).toBe(retryable);
    expect(failure.detail).toBe("Nope: Because.");
    expect(failure.message).not.toContain("key_secret_value");
  });

  it("copes with an error response that is not JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    const failure = await failureOf(createLifetimeCheckout(input, { fetchImpl }));
    expect(failure.kind).toBe("provider_unavailable");
    expect(failure.detail).toBeUndefined();
  });

  it("reports a network failure", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const failure = await failureOf(createLifetimeCheckout(input, { fetchImpl }));
    expect(failure.kind).toBe("network");
    expect(failure.retryable).toBe(true);
  });

  it("aborts and reports a timeout when the provider is too slow", async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const started = Date.now();
    const failure = await failureOf(
      createLifetimeCheckout(input, { fetchImpl: fetchImpl as typeof fetch, timeoutMs: 40 })
    );
    expect(failure.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it.each([
    ["a body that is not JSON", () => new Response("nope", { status: 200 })],
    ["JSON without a URL", () => jsonResponse(200, { data: { attributes: {} } })],
    ["a URL on another site", () => jsonResponse(200, { data: { attributes: { url: "https://evil.example/pay" } } })],
  ])("refuses %s", async (_label, makeResponse) => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse());
    const failure = await failureOf(createLifetimeCheckout(input, { fetchImpl }));
    expect(failure.kind).toBe("bad_response");
  });
});
