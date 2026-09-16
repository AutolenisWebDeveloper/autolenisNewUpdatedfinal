// POST /api/admin/buyers/[buyerId]/journey/reopen
// Admin reverses a completed stage back to its previous state.
// Writes the reversal DB record — e.g. sets onboardingComplete = false.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { advanceDealStatus, recordDealCorrection } from "@/lib/services/deal/deal.service";
import { z } from "zod";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  stageId: z.string().min(1),
  reason: z.string().min(1, "Reason is required to reopen a stage"),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      deals: {
        where: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, status: true, financingPath: true },
      },
    },
  });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid", 400);
  }

  const { stageId, reason } = parsed.data;
  const deal = buyer.deals[0] ?? null;
  let previousState: Record<string, unknown> = {};
  let newState: Record<string, unknown> = {};

  try {
    switch (stageId) {
      case "onboarding":
        previousState = { onboardingComplete: true };
        await prisma.buyer.update({ where: { id: buyerId }, data: { onboardingComplete: false } });
        newState = { onboardingComplete: false };
        break;

      case "prequal":
        previousState = { prequalDecision: "APPROVED" };
        await prisma.preQualification.update({
          where: { buyerId },
          data: { decision: "PENDING" },
        }).catch(() => {});
        newState = { prequalDecision: "PENDING" };
        break;

      case "financing":
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        previousState = { financingPath: deal.financingPath };
        await prisma.deal.update({ where: { id: deal.id }, data: { financingPath: null } });
        newState = { financingPath: null };
        break;

      case "fee":
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        previousState = { dealStatus: deal.status };
        // Backward admin override — force the guarded transition (records history).
        await advanceDealStatus(deal.id, "FEE_PENDING", {
          actorId: admin.adminId, actorRole: "ADMIN", reason, force: true,
          data: { feePaidAt: null, feeAmountCents: null },
        });
        newState = { feePaidAt: null, dealStatus: "FEE_PENDING" };
        break;

      case "insurance":
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        previousState = { insuranceStatus: "VERIFIED" };
        await advanceDealStatus(deal.id, "INSURANCE_PENDING", {
          actorId: admin.adminId, actorRole: "ADMIN", reason, force: true,
          data: { insuranceStatus: "NOT_STARTED" },
        });
        newState = { insuranceStatus: "NOT_STARTED" };
        break;

      case "contract":
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        previousState = { contractShieldStatus: "PASS" };
        await advanceDealStatus(deal.id, "CONTRACT_PENDING", {
          actorId: admin.adminId, actorRole: "ADMIN", reason, force: true,
          data: { contractShieldStatus: null },
        });
        newState = { contractShieldStatus: null };
        break;

      case "sign":
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        previousState = { dealStatus: deal.status };
        await advanceDealStatus(deal.id, "SIGNING_PENDING", {
          actorId: admin.adminId, actorRole: "ADMIN", reason, force: true,
        });
        newState = { dealStatus: "SIGNING_PENDING" };
        break;

      case "pickup":
        // OWNER RULING Q4, 2026-09-16 — A CAPABILITY REMOVED, DELIBERATELY.
        //
        // This case used to carry a COMPLETED deal back to PICKUP_SCHEDULED with `force: true`.
        // §Stage 20: "Completed is terminal. Corrections are append-only and never rewrite
        // completed history." A reopen is precisely a rewrite of completed history — the Deal's
        // status, its DealStatusHistory and the exactly-once completion event all describe a
        // handover that happened, and reversing the status leaves the other two describing a
        // transaction the record now denies.
        //
        // THE CAPABILITY IS NOT LOST, IT IS MOVED. What an operator actually needed here was to
        // record that something about a completed pickup was wrong. That is what
        // `deal_corrections` is for, and it is now written instead — append-only, carrying the
        // same reason, visible beside the deal, and leaving the completion intact.
        //
        // `advanceDealStatus` refuses this now even with `force`, so removing the call is not
        // what enforces the rule; the seam is. This route would receive a TerminalDealError.
        // The seam's guard is not conditioned on `force` — that, rather than where it sits
        // relative to the transition check, is what makes COMPLETED terminal.
        if (!deal) return adminError("NO_DEAL", "No active deal found", 400);
        if (deal.status !== "COMPLETED") {
          return adminError(
            "NOT_COMPLETED",
            "This deal has not completed, so there is no completed pickup to correct.",
            400,
          );
        }
        previousState = { dealStatus: "COMPLETED" };
        await recordDealCorrection({
          dealId: deal.id,
          kind: "PICKUP_REOPEN_REQUESTED",
          before: { dealStatus: "COMPLETED" },
          after: { dealStatus: "COMPLETED", correctionRequested: true },
          reason,
          actor: admin.email ?? admin.adminId,
        });
        newState = { dealStatus: "COMPLETED", correctionRecorded: true };
        break;

      default:
        return adminError("INVALID_STAGE", `Stage "${stageId}" cannot be reopened`, 400);
    }
  } catch (err) {
    return adminError("REOPEN_FAILED", err instanceof Error ? err.message : "Failed", 400);
  }

  // Remove any admin override record for this stage
  await prisma.adminJourneyUnlock.deleteMany({ where: { buyerId, stageId } });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "BUYER_JOURNEY_STAGE_REOPENED",
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      previousState: previousState as never,
      newState: newState as never,
      metadata: { stageId },
    },
  }).catch(() => {});

  return adminSuccess({ stageId, reopened: true });
}
