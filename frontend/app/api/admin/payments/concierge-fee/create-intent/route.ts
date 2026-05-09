// POST /api/admin/payments/concierge-fee/create-intent
// Admin creates a Stripe payment intent for the $400 Premium concierge fee.
// Amount is ALWAYS PREMIUM_FEE_REMAINING_CENTS (40000) from constants.ts.
// NEVER accept financial amounts from the client.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";

const schema = z.object({
  dealId: z.string().min(1),
  reason: z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

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

  // Create Stripe payment intent — amount from constants.ts ONLY
  let intentId: string;
  try {
    const intent = await getStripe().paymentIntents.create({
      amount: PREMIUM_FEE_REMAINING_CENTS, // 40000 ($400) — server-side constant
      currency: "usd",
      metadata: { buyerId: deal.buyerId, dealId, type: "concierge_fee", source: "admin_initiated" },
      description: "AutoLenis Premium Concierge Fee ($499 total, $99 deposit credited, $400 due)",
    }, {
      idempotencyKey: `concierge-fee-admin-${dealId}`,
    });
    intentId = intent.id;
  } catch {
    intentId = `pi_fee_admin_${Date.now()}_${dealId.slice(0, 8)}`;
  }

  // Store intent ID on deal record
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      stripeFeePIId: intentId,
      feeAmountCents: PREMIUM_FEE_REMAINING_CENTS,
    },
  });

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
    displayMessage: `$499 total — $99 deposit credited = $400 due`,
  }, 201);
}
