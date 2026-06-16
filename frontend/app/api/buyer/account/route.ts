// DELETE /api/buyer/account — buyer self-service account deletion.
// Removes or anonymises per-user data. Retains deals, contracts, payments for legal/tax retention.
// Signs user out by clearing Supabase session.

import { logger } from "@/lib/logger";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase";
import { successResponse, errorResponse } from "@/lib/auth/api";

const ANONYMIZED_FIRST_NAME = "Deleted";
const ANONYMIZED_LAST_NAME = "User";

export async function DELETE() {
  try {
    const buyer = await requireBuyer();

    // Check for active obligations that block deletion
    const activeDeal = await prisma.deal.findFirst({
      where: {
        buyerId: buyer.id,
        status: {
          in: [
            "PENDING",
            "ACTIVE",
            "FINANCING_PENDING",
            "FEE_PENDING",
            "FEE_PAID",
            "INSURANCE_PENDING",
            "CONTRACT_PENDING",
            "CONTRACT_REVIEW",
            "CONTRACT_APPROVED",
            "SIGNING_PENDING",
            "SIGNED",
            "PICKUP_SCHEDULED",
          ],
        },
      },
      select: { id: true },
    });
    if (activeDeal) {
      return errorResponse(
        "ACTIVE_DEAL",
        "You have an active deal in progress. Please complete or cancel it before deleting your account.",
        409,
      );
    }

    // Check whether any legally-retained records (deals, deposits, auctions) exist.
    // These have a non-nullable buyerId FK without onDelete: Cascade, so the buyer
    // row cannot be hard-deleted while they reference it.
    const [legalDeal, legalDeposit, legalAuction] = await Promise.all([
      prisma.deal.findFirst({ where: { buyerId: buyer.id }, select: { id: true } }),
      prisma.deposit.findFirst({ where: { buyerId: buyer.id }, select: { id: true } }),
      prisma.auction.findFirst({ where: { buyerId: buyer.id }, select: { id: true } }),
    ]);
    const hasLegalRecords = !!(legalDeal || legalDeposit || legalAuction);

    // Clean up non-legal records that lack onDelete: Cascade and would block deletion.
    // VehicleRequest sub-records (events, offers, etc.) cascade automatically from VehicleRequest.
    await prisma.$transaction([
      prisma.refinanceApplication.updateMany({ where: { buyerId: buyer.id }, data: { buyerId: null } }),
      prisma.vehicleRequest.deleteMany({ where: { buyerId: buyer.id } }),
      prisma.externalPreApproval.deleteMany({ where: { buyerId: buyer.id } }),
      prisma.tradeInSubmission.deleteMany({ where: { buyerId: buyer.id } }),
      prisma.financingScenario.deleteMany({ where: { buyerId: buyer.id } }),
      prisma.insuranceQuote.deleteMany({ where: { buyerId: buyer.id } }),
      prisma.insurancePolicy.deleteMany({ where: { buyerId: buyer.id } }),
    ]);

    if (hasLegalRecords) {
      // Soft-delete: remove PII but keep the row so Deal/Deposit/Auction FKs remain valid.
      await prisma.buyer.update({
        where: { id: buyer.id },
        data: {
          firstName: ANONYMIZED_FIRST_NAME,
          lastName: ANONYMIZED_LAST_NAME,
          phone: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          profilePictureUrl: null,
          employmentStatus: null,
          incomeRange: null,
          purgedAt: new Date(),
        },
      });
    } else {
      // No legal records — hard-delete the buyer row.
      // onDelete: Cascade in the schema removes buyer_preferences, saved_searches, etc.
      await prisma.buyer.delete({ where: { id: buyer.id } });
    }

    // Delete the auth row via admin API
    try {
      const admin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
      );
      await admin.auth.admin.deleteUser(buyer.user.supabaseId);
    } catch (err) {
      logger.error("[buyer/account:DELETE] Supabase admin delete failed", err);
      // Non-fatal — Prisma row is gone/anonymised; user can't re-login anyway
    }

    // Sign out the session
    try {
      const supabase = await createServerSupabaseClient();
      await supabase.auth.signOut();
    } catch { /* best-effort */ }

    return successResponse({ deleted: true });
  } catch (err) {
    logger.error("[buyer/account:DELETE] Unexpected error", err);
    return errorResponse("DELETE_FAILED", "Account deletion failed. Please contact support.", 500);
  }
}
