// POST /api/admin/buyers/[buyerId]/deposit/override
// Admin creates a deposit record and marks it PAID without going through Stripe.
// This unblocks auction creation for manual/administrative workflows.
// AuditLog entry with override reason required.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { sendDepositConfirmationEmail } from "@/lib/services/email/resend.service";
import { syncBuyerLifecycleToCrm } from "@/lib/services/admin/buyer-crm-sync";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: { user: { select: { email: true } } },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  // Precondition: don't stack a second unconsumed PAID deposit. An existing
  // PAID deposit not yet attached to an auction already unblocks the workflow.
  const existingPaid = await prisma.deposit.findFirst({
    where: { buyerId, status: "PAID", auction: null },
    select: { id: true },
  });
  if (existingPaid) {
    return adminError(
      "DEPOSIT_ALREADY_PAID",
      "Buyer already has an unused PAID deposit — no override needed.",
      400,
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { reason } = parsed.data;

  // Create deposit record as PAID (manual override — no Stripe)
  const deposit = await prisma.deposit.create({
    data: {
      buyerId,
      amountCents: DEPOSIT_AMOUNT_CENTS, // server-side from constants.ts
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

  // Notify the buyer their deposit is on file and the auction can proceed.
  await prisma.notification.create({
    data: {
      buyerId,
      type: "DEPOSIT_CONFIRMED",
      channel: "IN_APP",
      title: `${DEPOSIT_AMOUNT_USD} deposit confirmed`,
      body: "Your Auction Access Deposit has been recorded. Your auction can now be launched.",
      actionUrl: "/buyer/auctions",
    },
  }).catch((err) => console.error("[deposit/override] buyer notification failed:", err));

  if (buyer.user.email) {
    void sendDepositConfirmationEmail(buyer.user.email, buyer.firstName ?? "there", deposit.id)
      .catch((err) => console.error("[deposit/override] confirmation email failed:", err));
  }

  // Stage advances to deposit_paid in the CRM as well as Prisma (deposit row).
  await syncBuyerLifecycleToCrm(
    buyerId,
    "deposit_paid",
    { adminId: admin.adminId, adminEmail: admin.email },
    buyer.user.email,
  );

  return adminSuccess({
    deposit: {
      id: deposit.id,
      buyerId: deposit.buyerId,
      amountCents: deposit.amountCents,
      status: deposit.status,
    },
    buyerNotified: true,
  }, 201);
}
