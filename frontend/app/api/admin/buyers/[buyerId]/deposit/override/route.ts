// POST /api/admin/buyers/[buyerId]/deposit/override
// Admin creates a deposit record and marks it PAID without going through Stripe.
// This unblocks auction creation for manual/administrative workflows.
// AuditLog entry with override reason required.

import { requirePermissionStrict } from "@/lib/auth/permissions";
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS, DEPOSIT_AMOUNT_USD } from "@/lib/constants";
import { sendDepositConfirmationEmail } from "@/lib/services/email/resend.service";
import { syncBuyerLifecycleToCrm } from "@/lib/services/admin/buyer-crm-sync";
import { reconcileDepositActivation } from "@/lib/services/auction/deposit-activation.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  reason: z.string().min(1, "Override reason is required"),
});

// Activation outcomes that mean the deposit now has a live auction behind it.
// Anything else leaves the buyer without one and must not be reported as unblocked.
const UNBLOCKED_OUTCOMES = new Set(["ok", "invited", "awaiting_dealers"]);

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const adminCheck = await requirePermissionStrict(request, "finance.deposit.override");
  // Hard-enforced (not via the shadow flag), and the allow-list is read from
  // PERMISSION_ROLES rather than restated here: a duplicated inline role set is
  // a second source of policy that can drift from the matrix it is meant to mirror.
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

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
      metadata: {
        buyerId,
        amountCents: DEPOSIT_AMOUNT_CENTS,
        status: "PAID",
        override: true,
        // Distinguishes admin-origin PAID from provider-confirmed PAID. No
        // PaymentProviderEvent is written — there is no Stripe evidence behind an
        // override, and fabricating one would falsify the ledger. The Program 1
        // health invariant surfaces such deposits for reconciliation instead.
        providerConfirmed: false,
      },
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
  }).catch((err) => logger.error("[deposit/override] buyer notification failed:", err));

  if (buyer.user.email) {
    void sendDepositConfirmationEmail(buyer.user.email, buyer.firstName ?? "there", deposit.id)
      .catch((err) => logger.error("[deposit/override] confirmation email failed:", err));
  }

  // Stage advances to deposit_paid in the CRM as well as Prisma (deposit row).
  await syncBuyerLifecycleToCrm(
    buyerId,
    "deposit_paid",
    { adminId: admin.adminId, adminEmail: admin.email },
    buyer.user.email,
  );

  // Canonical post-payment fulfillment — the SAME convergence the activation
  // reconciler drives for a deposit the Stripe webhook left stranded (create the
  // auction, launch it, invite dealers) or refuses and surfaces as an operational
  // exception (concierge / indeterminate track). Minting PAID without it is what
  // left paid buyers with no auction and no way forward.
  //
  // Idempotent and serialized per deposit, so re-running it — or a Stripe webhook
  // arriving later for the same deposit — cannot double-launch or double-invite.
  // Best-effort relative to the money fact: the deposit has already committed and
  // a fulfillment failure must not un-record it; the reconciler cron re-attempts.
  let fulfillment = "unavailable";
  try {
    fulfillment = await reconcileDepositActivation(deposit.id);
  } catch (err) {
    logger.error(`[deposit/override] fulfillment failed for deposit ${deposit.id} (deposit remains PAID):`, err);
  }

  return adminSuccess({
    deposit: {
      id: deposit.id,
      buyerId: deposit.buyerId,
      amountCents: deposit.amountCents,
      status: deposit.status,
    },
    buyerNotified: true,
    fulfillment,
    auctionUnblocked: UNBLOCKED_OUTCOMES.has(fulfillment),
  }, 201);
}
