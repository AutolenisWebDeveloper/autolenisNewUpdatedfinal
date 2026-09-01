// POST /api/admin/payments/concierge-fee/create-intent
// Admin creates a Stripe payment intent for the Premium concierge fee balance.
// Amount is ALWAYS PREMIUM_FEE_REMAINING_CENTS from constants.ts.
// NEVER accept financial amounts from the client.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import {
  PREMIUM_FEE_REMAINING_CENTS,
  PREMIUM_FEE_USD,
  PREMIUM_FEE_REMAINING_USD,
  DEPOSIT_AMOUNT_USD,
} from "@/lib/constants";

import { limitPaymentIntent } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  dealId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  // Throttle intent creation per admin account; fails CLOSED on store outage.
  const rl = await limitPaymentIntent(`fee:admin:${admin.adminId}`, { tokens: 30, window: "1 h" });
  if (!rl.ok) return adminError("RATE_LIMITED", rl.message, rl.status);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { dealId, reason } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: { include: { user: true } } },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);
  if (deal.buyer.plan !== "PREMIUM") return adminError("NOT_PREMIUM", "Concierge fee only applies to Premium plan buyers", 400);

  // Create Stripe payment intent — amount from constants.ts ONLY.
  //
  // A Stripe failure is reported as a failure. This used to fall back to
  // `pi_fee_admin_<ts>_<deal>` and store that as the fee's payment reference — a
  // fabricated identifier for a PaymentIntent that does not exist at Stripe, in
  // the field the refund route, the admin payment views and the dealer document
  // link all read as the real one.
  let intentId: string;
  try {
    const intent = await getStripe().paymentIntents.create({
      amount: PREMIUM_FEE_REMAINING_CENTS, // server-side constant from constants.ts
      currency: "usd",
      metadata: { buyerId: deal.buyerId, dealId, type: "concierge_fee", source: "admin_initiated" },
      description: `AutoLenis Premium Concierge Fee (${PREMIUM_FEE_USD} total, ${DEPOSIT_AMOUNT_USD} deposit credited, ${PREMIUM_FEE_REMAINING_USD} due)`,
    }, {
      idempotencyKey: `concierge-fee-admin-${dealId}`,
    });
    intentId = intent.id;
  } catch (err) {
    logger.error("[admin/concierge-fee/create-intent] Stripe intent creation failed:", err);
    return adminError("STRIPE_ERROR", "Could not create the payment intent. Please try again.", 503);
  }

  // NOTHING is written to the Deal here, deliberately.
  //
  // Creating an intent is an invitation to pay, not a payment. `stripeFeePIId`
  // and `feeAmountCents` are settlement fields — the Stripe webhook writes both
  // when the fee is actually captured, and it finds this deal by the `dealId`
  // stamped into the metadata above, so it never needed the row pre-populated.
  // Writing them early put an uncharged fee into the buyer's "Service Fee
  // History" on /buyer/billing, with an amount beside it.
  //
  // The intent id is not lost: it is in the audit log below and in the response.

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "CONCIERGE_FEE_INTENT_CREATED",
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: { buyerId: deal.buyerId, amountCents: PREMIUM_FEE_REMAINING_CENTS, intentId },
    },
  });

  return adminSuccess({
    dealId,
    stripePaymentIntentId: intentId,
    amountCents: PREMIUM_FEE_REMAINING_CENTS,
    displayMessage: `${PREMIUM_FEE_USD} total — ${DEPOSIT_AMOUNT_USD} deposit credited = ${PREMIUM_FEE_REMAINING_USD} due`,
  }, 201);
}
