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

export async function refundPaymentIntent(paymentIntentId: string, reason: string) {
  return getStripe().refunds.create({ payment_intent: paymentIntentId, metadata: { reason } });
}

export async function retrievePaymentIntent(paymentIntentId: string) {
  return getStripe().paymentIntents.retrieve(paymentIntentId);
}

export async function constructWebhookEvent(body: string, signature: string, secret: string) {
  return getStripe().webhooks.constructEvent(body, signature, secret);
}
