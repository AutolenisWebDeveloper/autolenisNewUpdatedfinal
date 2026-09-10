// POST /api/admin/payments/deposit/send-link
// Admin creates a Stripe Checkout Session for the Auction Access Deposit and emails the link to the buyer.
// Amount is ALWAYS DEPOSIT_AMOUNT_CENTS from constants.ts — never from request body.

import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { sendDepositPaymentLinkEmail } from "@/lib/services/email/resend.service";
import {
  findExistingDepositObligation,
  blocksNewIntent,
} from "@/lib/services/payment/deposit-obligation";
import { findOpenRequest } from "@/lib/services/vehicle-request/open-request.service";

const schema = z.object({
  buyerId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: NextRequest) {
  // Tier 1 (Finding 5): enforced directly from PERMISSION_ROLES.
  // Creates a Stripe Checkout session and sends the buyer a payment link.
  const adminCheck = await requirePermissionStrict(request, "finance.payment_link.send");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { buyerId, reason } = parsed.data;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // MONEY-PATH DEFECT 4, fixed at the cause. This route used to look only for a
  // PENDING row. A buyer whose deposit was already PAID therefore matched nothing, so
  // the code below inserted a SECOND Deposit row and mailed them a SECOND Checkout
  // Session for money they had already paid — and because the two rows then competed
  // at settlement, the damage was not limited to the charge.
  //
  // The shared check asks Stripe, which is what §5d requires: our own column can say
  // PENDING for a payment that settled days ago behind a missed webhook.
  // REQUEST-SCOPED, exactly as the buyer route is.
  //
  // Found by the independent review: these two called the shared check with the buyer
  // alone. `OBLIGATION_BEARING` includes PAID, so for a repeat buyer whose FIRST request
  // was completed and paid, Stripe reports that old intent as succeeded, the check
  // returns SETTLED, and both admin routes answer ALREADY_PAID — permanently. An admin
  // could never issue or mail a $99 for any buyer's second request, while the buyer's
  // own route worked, because only that one passed the request. §23.1 is explicit that
  // "a new request means a new $99", and the shared check documents the scoping as
  // required; two of its three callers simply did not supply it.
  const openRequest = await findOpenRequest(buyerId);
  const obligation = await findExistingDepositObligation({
    buyerId,
    vehicleRequestId: openRequest?.id ?? null,
  });

  if (blocksNewIntent(obligation)) {
    if (obligation.kind === "SETTLED") {
      return adminError(
        "ALREADY_PAID",
        `This buyer has already paid the ${DEPOSIT_AMOUNT_USD} deposit (Stripe intent ` +
          `${obligation.paymentIntentId}, deposit ${obligation.deposit.id}). Sending another payment ` +
          `link would charge them twice.`,
        409,
      );
    }
    return adminError(
      "PROVIDER_UNREACHABLE",
      "Stripe could not be reached to confirm whether this buyer already has an outstanding or " +
        "settled deposit. Refusing to send a second payment link. Try again shortly.",
      503,
    );
  }

  // Reuse the row the obligation names. An IN_FLIGHT intent keeps its Deposit; an
  // UNVERIFIABLE row (no intent yet — the normal state for a link that has not been
  // paid) is the one this link belongs to. Only a genuinely empty result inserts.
  const existing =
    obligation.kind === "IN_FLIGHT" || obligation.kind === "UNVERIFIABLE" ? obligation.deposit : null;

  const deposit =
    existing ??
    (await prisma.deposit.create({
      data: {
        buyerId,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PENDING",
      },
    }));

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
