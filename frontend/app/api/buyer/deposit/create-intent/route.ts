import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { getStripe } from "@/lib/stripe";

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
    // Amount is hardcoded server-side — NEVER accept from frontend (price manipulation prevention)
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: DEPOSIT_AMOUNT_CENTS, // $99 hardcoded
      currency: "usd",
      metadata: { buyerId: buyer.id, type: "deposit" },
    }, {
      idempotencyKey: `deposit-buyer-${buyer.id}`,
    });

    // Create pending deposit record
    await prisma.deposit.create({
      data: {
        buyerId: buyer.id,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
        stripePaymentIntentId: paymentIntent.id,
      },
    });

    return successResponse({ clientSecret: paymentIntent.client_secret });
  } catch {
    return errorResponse("STRIPE_ERROR", "Payment service unavailable. Please try again.", 503);
  }
}
