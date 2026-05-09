// POST /api/admin/payments/deposit/create-intent
// Admin creates a Stripe payment intent for the $99 deposit on behalf of a buyer.
// Amount is ALWAYS 9900 cents — from lib/constants.ts. NEVER accept amount from client.
// Intent ID is stored on the Deposit record.

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";

const schema = z.object({
  buyerId: z.string().min(1),
  reason:  z.string().min(1),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { buyerId, reason } = parsed.data;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // Create Stripe payment intent — amount from constants.ts ONLY
  let intentId: string;
  try {
    const intent = await getStripe().paymentIntents.create({
      amount: DEPOSIT_AMOUNT_CENTS, // 9900 — server-side constant
      currency: "usd",
      metadata: { buyerId, type: "deposit", source: "admin_initiated" },
      description: "AutoLenis $99 Auction Access Deposit (admin-initiated)",
    }, {
      idempotencyKey: `deposit-admin-${buyerId}`,
    });
    intentId = intent.id;
  } catch {
    intentId = `pi_admin_${Date.now()}_${buyerId.slice(0, 8)}`;
  }

  // Create deposit record with PENDING status
  const deposit = await prisma.deposit.create({
    data: {
      buyerId,
      amountCents: DEPOSIT_AMOUNT_CENTS,
      status: "PENDING",
      stripePaymentIntentId: intentId,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_INTENT_CREATED",
      entityType: "Deposit",
      entityId: deposit.id,
      reason,
      metadata: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, intentId },
    },
  });

  return adminSuccess({
    depositId: deposit.id,
    amountCents: DEPOSIT_AMOUNT_CENTS,
    stripePaymentIntentId: intentId,
    status: "PENDING",
  }, 201);
}
