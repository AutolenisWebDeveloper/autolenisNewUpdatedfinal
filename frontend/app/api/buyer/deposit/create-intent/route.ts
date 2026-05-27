import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";
import { dispatch } from "@/lib/qstash/dispatch";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // D1: Verify prequal is valid (expiresAt > now) before allowing deposit
  const prequal = buyer.preQualification;
  if (!prequal || prequal.expiresAt <= new Date()) {
    return errorResponse("PREQUAL_REQUIRED", "Valid prequalification required before deposit", 400);
  }

  // Check for existing active deposit
  const existingDeposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id, status: { in: ["PENDING", "PAID"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existingDeposit?.status === "PAID") {
    return errorResponse("ALREADY_PAID", "Deposit already paid for this buyer", 400);
  }

  // Sandbox short-circuit: if a live Stripe key is configured outside production,
  // return a mock client secret so the UI can proceed without exposing real Stripe.
  const stripeKey = process.env.STRIPE_SECRET_KEY ?? "";
  const isLiveKey = stripeKey.startsWith("sk_live_");
  const isSandboxRuntime = process.env.NODE_ENV !== "production";
  if (isLiveKey && isSandboxRuntime) {
    // eslint-disable-next-line no-console
    console.warn("WARNING: Using live Stripe key in sandbox mode — returning mock intent.");
    // Reuse an existing mock so the buyer doesn't accumulate orphan PENDING rows.
    if (existingDeposit?.stripePaymentIntentId?.startsWith("pi_sandbox_mock_")) {
      return successResponse({ clientSecret: "pi_sandbox_mock_secret", mock: true });
    }
    const mockIntentId = `pi_sandbox_mock_${Date.now()}`;
    await prisma.deposit.create({
      data: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: mockIntentId,
      },
    });
    return successResponse({
      clientSecret: "pi_sandbox_mock_secret",
      mock: true,
    });
  }

  try {
    // If a PENDING deposit row already has a live Stripe PI attached, reuse
    // that intent rather than creating a parallel one. Stripe idempotency
    // keys live for 24h, so on a same-day retry create() would return the
    // same PI anyway — but the original `client_secret` is not echoed back
    // by Stripe on a key hit, so we have to retrieve it explicitly here to
    // avoid the unique-index P2002 on Deposit.stripePaymentIntentId.
    if (existingDeposit?.stripePaymentIntentId) {
      const existingPi = await getStripe().paymentIntents.retrieve(
        existingDeposit.stripePaymentIntentId,
      );
      const isReusable =
        existingPi.status === "requires_payment_method" ||
        existingPi.status === "requires_confirmation" ||
        existingPi.status === "requires_action";
      if (isReusable && existingPi.client_secret) {
        return successResponse({ clientSecret: existingPi.client_secret });
      }
      // PI is in a terminal state (canceled/failed) — mark deposit failed
      // and fall through to create a fresh one below.
      if (existingPi.status === "canceled" || existingDeposit.status !== "PENDING") {
        await prisma.deposit.update({
          where: { id: existingDeposit.id },
          data: { status: "FAILED" },
        });
      }
    }

    // Amount is hardcoded server-side — NEVER accept from frontend (price manipulation prevention).
    // Idempotency key is bucketed by UTC day so that two near-simultaneous clicks
    // share a PI, but a buyer returning the next day gets a fresh intent (the
    // previous day's PI may already be canceled by Stripe's automatic timeout).
    const dayKey = new Date().toISOString().slice(0, 10);
    const paymentIntent = await getStripe().paymentIntents.create(
      {
        amount: DEPOSIT_AMOUNT_CENTS, // $99 hardcoded
        currency: "usd",
        metadata: { buyerId: buyer.id, type: "deposit" },
      },
      { idempotencyKey: `deposit-buyer-${buyer.id}-${dayKey}` },
    );

    // upsert protects against the race where a concurrent retry already
    // wrote a Deposit row for this PI (unique on stripePaymentIntentId).
    await prisma.deposit.upsert({
      where: { stripePaymentIntentId: paymentIntent.id },
      create: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
      },
      update: {},
    });

    // QStash — start the deposit-activation reminder sequence. The job
    // self-stops once the deposit is PAID, so re-creating an intent is safe.
    const buyerContact = await prisma.buyer.findUnique({
      where: { id: buyer.id },
      select: { firstName: true, user: { select: { email: true } } },
    });
    if (buyerContact?.user?.email) {
      dispatch({
        path: "/api/jobs/deposit-reminder",
        body: {
          buyerId: buyer.id,
          firstName: buyerContact.firstName,
          email: buyerContact.user.email,
          touchNumber: 1,
        },
        delaySeconds: 86400,
      }).catch(() => {});
    }

    return successResponse({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("[deposit/create-intent] Stripe error:", err);
    return errorResponse("STRIPE_ERROR", "Payment service unavailable. Please try again.", 503);
  }
}
