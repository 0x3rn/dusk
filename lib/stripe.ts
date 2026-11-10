import Stripe from "stripe";
import { getServerEnv } from "./env";

let _stripe: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor(what: string) {
    super(`${what} is not configured on this server.`);
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = getServerEnv().STRIPE_SECRET_KEY;
    if (!key) throw new StripeNotConfiguredError("STRIPE_SECRET_KEY");
    _stripe = new Stripe(key, {
      apiVersion: "2026-05-27.dahlia",
      appInfo: {
        name: "Dusk Digital Vault",
        version: "0.1.0",
      },
    });
  }
  return _stripe;
}
