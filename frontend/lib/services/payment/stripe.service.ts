// lib/services/payment/stripe.service.ts
import { getStripe } from "@/lib/stripe";

export async function createPaymentIntent(
  amountCents: number,
  metadata: Record<string, string>,
  idempotencyKey: string
) {
  return getStripe().paymentIntents.create(
    { amount: amountCents, currency: "usd", metadata },
    { idempotencyKey }
  );
}

export async function refundPaymentIntent(
  paymentIntentId: string,
  reason: string,
  idempotencyKey?: string,
) {
  // Idempotency key prevents a retry / double-invocation from issuing a SECOND
  // real refund. Callers refunding a deposit should pass the deposit-scoped key
  // so every refund path for the same deposit collapses to one Stripe refund.
  return getStripe().refunds.create(
    { payment_intent: paymentIntentId, metadata: { reason } },
    { idempotencyKey: idempotencyKey ?? `refund-${paymentIntentId}` },
  );
}

export async function retrievePaymentIntent(
  paymentIntentId: string,
  params?: { expand?: string[] },
) {
  return params
    ? getStripe().paymentIntents.retrieve(paymentIntentId, params)
    : getStripe().paymentIntents.retrieve(paymentIntentId);
}

export async function constructWebhookEvent(body: string, signature: string, secret: string) {
  return getStripe().webhooks.constructEvent(body, signature, secret);
}
