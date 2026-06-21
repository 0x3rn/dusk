import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
      apiVersion: "2026-05-27.dahlia",
      appInfo: {
        name: "Dusk Digital Vault",
        version: "0.1.0",
      },
    });
  }
  return _stripe;
}
