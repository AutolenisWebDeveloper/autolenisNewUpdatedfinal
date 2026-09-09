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

/**
 * Every PaymentIntent Stripe holds that is stamped with this deposit id.
 *
 * The reconciler needs it for one class of row it otherwise cannot resolve: an admin
 * send-link deposit carries NO `stripePaymentIntentId` until its Checkout Session
 * produces one and the webhook writes it back. If that webhook is the one that went
 * missing, the buyer has paid and the row points at nothing. Our own database cannot
 * answer "did this get paid?" for such a row — only Stripe can, and only by metadata.
 *
 * TWO PROPERTIES OF THE SEARCH API THAT MATTER HERE, so callers do not mistake it for
 * a strong guard:
 *   • it is EVENTUALLY CONSISTENT, roughly a minute behind. That is fine for a
 *     reconciler running on a 5-minute cron and looking at rows already older than the
 *     15-minute grace window, and it is why this must never be used as a pre-create
 *     duplicate check, where a fresh intent would not yet be indexed.
 *   • it returns intents in ANY status. Callers classify.
 *
 * The id is validated before interpolation. Stripe's query language is a string
 * grammar, so a value carrying a quote would change the meaning of the query rather
 * than being matched literally.
 */
export async function searchPaymentIntentsByDepositId(depositId: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(depositId)) {
    throw new Error(`searchPaymentIntentsByDepositId: refusing to query with unsafe id "${depositId}"`);
  }
  const res = await getStripe().paymentIntents.search({
    query: `metadata['depositId']:'${depositId}'`,
    limit: 10,
  });
  return res.data;
}

export async function constructWebhookEvent(body: string, signature: string, secret: string) {
  return getStripe().webhooks.constructEvent(body, signature, secret);
}
