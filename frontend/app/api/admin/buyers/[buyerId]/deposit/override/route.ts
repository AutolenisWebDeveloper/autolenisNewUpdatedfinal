// POST /api/admin/buyers/[buyerId]/deposit/override
// Admin creates a deposit record and marks it PAID without going through Stripe.
// This unblocks auction creation for manual/administrative workflows.
// AuditLog entry with override reason required.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  // Create deposit record as PAID (manual override — no Stripe)
  const deposit = await prisma.deposit.create({
    data: {
      buyerId,
      amountCents: DEPOSIT_AMOUNT_CENTS, // Always $99 — server-side from constants.ts
      status: "PAID",
      // No stripePaymentIntentId — this is a manual admin override
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "DEPOSIT_MANUAL_OVERRIDE",
      entityType: "Deposit",
      entityId: deposit.id,
      reason,
      metadata: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID", override: true },
    },
  });

  return adminSuccess({
    deposit: {
      id: deposit.id,
      buyerId: deposit.buyerId,
      amountCents: deposit.amountCents,
      status: deposit.status,
    },
  }, 201);
}
