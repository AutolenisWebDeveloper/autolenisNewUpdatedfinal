// POST /api/admin/payments/deposit/send-link
// Admin creates a Stripe Checkout Session for the Auction Access Deposit and emails the link to the buyer.
// Amount is ALWAYS DEPOSIT_AMOUNT_CENTS from constants.ts — never from request body.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { sendDepositPaymentLinkEmail } from "@/lib/services/email/resend.service";

const schema = z.object({
  buyerId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { buyerId, reason } = parsed.data;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // Create or reuse existing PENDING deposit record
  let deposit = await prisma.deposit.findFirst({
    where: { buyerId, status: "PENDING" },
  });
  if (!deposit) {
    deposit = await prisma.deposit.create({
      data: {
        buyerId,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
      },
    });
  }

  // Create Stripe Checkout Session
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim();
  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: DEPOSIT_AMOUNT_CENTS,
          product_data: { name: `AutoLenis ${DEPOSIT_AMOUNT_USD} Auction Access Deposit` },
        },
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/buyer/deposit/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/buyer/deposit`,
    customer_email: buyer.user.email,
    metadata: {
      buyerId,
      depositId: deposit.id,
      type: "deposit",
      source: "admin_payment_link",
    },
    // BUG2 FIX: Copy metadata to the PaymentIntent so payment_intent.succeeded
    // webhook can read type/buyerId/depositId from pi.metadata (Checkout sessions
    // do NOT auto-copy session metadata to the underlying PI).
    payment_intent_data: {
      metadata: {
        buyerId,
        depositId: deposit.id,
        type: "deposit",
        source: "admin_payment_link",
      },
    },
    expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }, {
    // Date.now() is intentional: each admin-initiated link resend is a distinct operation,
    // not a retry. A new checkout session should be created each time.
    idempotencyKey: `deposit-link-${buyerId}-${Date.now()}`,
  });

  const checkoutUrl = session.url!;

  // The actual payment_intent ID will be set on the deposit record
  // when the Stripe Checkout session completes (via webhook).
  // We do not store the checkout session ID here to avoid conflating
  // cs_* session IDs with pi_* payment intent IDs in stripePaymentIntentId.

  // Send email to buyer
  await sendDepositPaymentLinkEmail({
    to: buyer.user.email,
    firstName: buyer.firstName,
    checkoutUrl,
    depositId: deposit.id,
  });

  // Audit log
  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_PAYMENT_LINK_SENT",
      entityType: "Deposit",
      entityId: deposit.id,
      reason,
      metadata: { buyerId, depositId: deposit.id, sentTo: buyer.user.email, checkoutSessionId: session.id },
    },
  });

  return adminSuccess({
    checkoutUrl,
    depositId: deposit.id,
    sentTo: buyer.user.email,
  }, 201);
}
