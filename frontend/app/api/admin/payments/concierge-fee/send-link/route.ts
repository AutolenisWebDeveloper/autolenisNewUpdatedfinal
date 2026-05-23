// POST /api/admin/payments/concierge-fee/send-link
// Admin creates a Stripe Checkout Session for the concierge fee balance and emails the link to the buyer.
// Amount is ALWAYS PREMIUM_FEE_REMAINING_CENTS from constants.ts — never from request body.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import {
  PREMIUM_FEE_REMAINING_CENTS,
  PREMIUM_FEE_USD,
  PREMIUM_FEE_REMAINING_USD,
  DEPOSIT_AMOUNT_USD,
} from "@/lib/constants";
import { sendConciergeFeePaymentLinkEmail } from "@/lib/services/email/resend.service";

const schema = z.object({
  dealId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

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

  // Create Stripe Checkout Session
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: PREMIUM_FEE_REMAINING_CENTS,
          product_data: { name: `AutoLenis ${PREMIUM_FEE_USD} Concierge Fee (${DEPOSIT_AMOUNT_USD} deposit credited — ${PREMIUM_FEE_REMAINING_USD} due)` },
        },
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/buyer/deal/payment?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/buyer/deal/fee`,
    customer_email: deal.buyer.user.email,
    metadata: {
      buyerId: deal.buyerId,
      dealId,
      type: "concierge_fee",
      source: "admin_payment_link",
    },
    // BUG3 FIX: Copy metadata to the PaymentIntent so payment_intent.succeeded
    // webhook can read type/buyerId/dealId from pi.metadata (Checkout sessions
    // do NOT auto-copy session metadata to the underlying PI).
    payment_intent_data: {
      metadata: {
        buyerId: deal.buyerId,
        dealId,
        type: "concierge_fee",
        source: "admin_payment_link",
      },
    },
    expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }, {
    // Date.now() is intentional: each admin-initiated link resend is a distinct operation,
    // not a retry. A new checkout session should be created each time.
    idempotencyKey: `concierge-fee-link-${dealId}-${Date.now()}`,
  });

  const checkoutUrl = session.url!;

  // Only update feeAmountCents — the actual payment_intent ID will be set
  // when the Stripe Checkout session completes (via webhook).
  // We do not store the checkout session ID in stripeFeePIId to avoid
  // conflating cs_* session IDs with pi_* payment intent IDs.
  if (!deal.feeAmountCents) {
    await prisma.deal.update({
      where: { id: dealId },
      data: { feeAmountCents: PREMIUM_FEE_REMAINING_CENTS },
    });
  }

  // Send email to buyer
  await sendConciergeFeePaymentLinkEmail({
    to: deal.buyer.user.email,
    firstName: deal.buyer.firstName,
    checkoutUrl,
    dealId,
  });

  // Audit log
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "CONCIERGE_FEE_PAYMENT_LINK_SENT",
      entityType: "Deal",
      entityId: dealId,
      reason,
      metadata: { buyerId: deal.buyerId, dealId, sentTo: deal.buyer.user.email, checkoutSessionId: session.id },
    },
  });

  return adminSuccess({
    checkoutUrl,
    dealId,
    sentTo: deal.buyer.user.email,
  }, 201);
}
