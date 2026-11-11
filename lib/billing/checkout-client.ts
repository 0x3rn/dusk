// lib/billing/checkout-client.ts
// Browser-side logic for "Buy lifetime access", shared by the landing page and Settings.
// Kept free of React and of window access (everything is passed in) so it can be tested from
// the terminal. It never navigates by itself: it returns what should happen.

export const CHECKOUT_TIMEOUT_MS = 20_000;

export const CHECKOUT_ERROR_MESSAGE =
  "We couldn't start checkout. You haven't been charged. Please try again in a moment.";
export const CHECKOUT_RATE_LIMITED_MESSAGE =
  "You've started checkout several times in a row. You haven't been charged. Please wait a few minutes and try again.";
export const CHECKOUT_SUPPORT_PLACEHOLDER = "[SUPPORT EMAIL TO BE ADDED]";

export type CheckoutResult =
  /** Checkout is ready: send the browser to this Lemon Squeezy page. */
  | { kind: "redirect"; url: string }
  /** Nobody is signed in: send them to create an account, then bring them back. */
  | { kind: "needs-account" }
  /** The account already has lifetime access. */
  | { kind: "already-purchased" }
  /** Checkout could not start. Stay on the page and show `message` with a retry. */
  | { kind: "error"; message: string };

export interface StartCheckoutDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Same rule as the server: https and a lemonsqueezy.com host, nothing else. */
function isCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
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

async function readBody(res: Response): Promise<{ url?: unknown; code?: unknown }> {
  try {
    const data: unknown = await res.json();
    return data && typeof data === "object" ? (data as { url?: unknown; code?: unknown }) : {};
  } catch {
    return {};
  }
}

export async function startCheckout(deps: StartCheckoutDeps = {}): Promise<CheckoutResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? CHECKOUT_TIMEOUT_MS);
  try {
    const res = await fetchImpl("/api/checkout", { method: "POST", signal: controller.signal });
    if (res.status === 401) return { kind: "needs-account" };
    const body = await readBody(res);
    if (res.status === 409 && body.code === "ALREADY_PURCHASED") return { kind: "already-purchased" };
    if (res.status === 429) return { kind: "error", message: CHECKOUT_RATE_LIMITED_MESSAGE };
    if (res.ok && isCheckoutUrl(body.url)) return { kind: "redirect", url: body.url };
    return { kind: "error", message: CHECKOUT_ERROR_MESSAGE };
  } catch {
    // Network failure or timeout: nothing was charged because nothing reached the payment page.
    return { kind: "error", message: CHECKOUT_ERROR_MESSAGE };
  } finally {
    clearTimeout(timer);
  }
}

// --- "Create your account first, then come back to checkout" -------------------------------
// The only value the sign-in and sign-up pages accept in ?next= is the word "checkout".
// It is never used as a URL, so it cannot be turned into an open redirect.

export const CHECKOUT_INTENT_VALUE = "checkout";
export const REGISTER_FOR_CHECKOUT_PATH = `/register?next=${CHECKOUT_INTENT_VALUE}`;
export const RESUME_CHECKOUT_PATH = "/?checkout=resume";
export const DEFAULT_AFTER_SIGN_IN_PATH = "/dashboard";

/** True only for exactly `next=checkout` (a query string such as `?next=checkout&x=1`). */
export function hasCheckoutIntent(search: string): boolean {
  return new URLSearchParams(search).get("next") === CHECKOUT_INTENT_VALUE;
}

/** Where to go after signing in or up: back to checkout if that was the intent, else the dashboard. */
export function afterSignInPath(search: string): string {
  return hasCheckoutIntent(search) ? RESUME_CHECKOUT_PATH : DEFAULT_AFTER_SIGN_IN_PATH;
}

/** Link between the sign-in and sign-up pages that keeps the checkout intent. */
export function withCheckoutIntent(path: "/login" | "/register", search: string): string {
  return hasCheckoutIntent(search) ? `${path}?next=${CHECKOUT_INTENT_VALUE}` : path;
}

/** True when the landing page was opened to resume a checkout (`/?checkout=resume`). */
export function isResumeCheckout(search: string): boolean {
  return new URLSearchParams(search).get("checkout") === "resume";
}
