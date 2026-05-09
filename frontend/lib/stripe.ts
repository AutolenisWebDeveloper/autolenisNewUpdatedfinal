// lib/stripe.ts
// Lazy Stripe getter — never instantiated at module scope.
// Throws a hard error if STRIPE_SECRET_KEY is missing, rather than
// falling back to a placeholder that silently lets bad requests through.

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "[stripe] STRIPE_SECRET_KEY is not set. " +
        "Add it to your environment variables."
    );
  }
  _stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return _stripe;
}