// POST /api/admin/buyers/[buyerId]/journey/complete
// Marks a buyer journey stage as organically complete by writing real DB records.
// Uses existing service functions to ensure DealStatusHistory + audit trails.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PreQualTier } from "@prisma/client";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { moveBuyerWorkflowStage } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  stageId: z.enum([
    "account","onboarding","prequal","search","shortlist","deposit",
    "auction","select-deal","financing","fee","insurance",
    "contract","sign","pickup",
  ]),
  note:              z.string().max(500).optional(),
  maxOtdAmountCents: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required to complete journey stages", 403);
  }

  const { buyerId } = await params;
  const buyer = await prisma.buyer.findUnique({
    where: { id: buyerId },
    include: {
      deals: {
        where: { status: { notIn: ["CANCELLED", "REFUNDED"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true, status: true, financingPath: true,
          feePaidAt: true, insuranceStatus: true, contractShieldStatus: true,
        },
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

  const { stageId, note, maxOtdAmountCents } = parsed.data;
  const reason = note ?? `Admin completed stage: ${stageId}`;
  const activeDeal = buyer.deals[0] ?? null;
  const adminId = admin.adminId;
  const adminEmail = admin.email;

  // Helper: advance deal status using existing service (handles DealStatusHistory + audit)
  async function advanceDeal(targetStatus: string) {
    if (!activeDeal) throw new Error("No active deal found for this buyer");
    await moveBuyerWorkflowStage(
      buyerId,
      adminId,
      adminEmail,
      activeDeal.id,
      targetStatus as Parameters<typeof moveBuyerWorkflowStage>[4],
      reason
    );
  }

  let action: string;

  switch (stageId) {

    // account — always complete, nothing to write
    case "account":
      action = "JOURNEY_COMPLETE_ACCOUNT";
      break;

    // onboarding — set buyer.onboardingComplete = true
    case "onboarding":
      await prisma.buyer.update({
        where: { id: buyerId },
        data: { onboardingComplete: true, termsAcceptedAt: new Date() },
      });
      action = "JOURNEY_COMPLETE_ONBOARDING";
      break;

    // prequal — upsert PreQualification as APPROVED, 90-day expiry
    case "prequal": {
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const maxOtd = maxOtdAmountCents ?? 5000000; // $50,000 default
      await prisma.preQualification.upsert({
        where: { buyerId },
        create: {
          buyerId, decision: "APPROVED", tier: PreQualTier.GOOD,
          maxOtdAmountCents: maxOtd, expiresAt,
          isExternal: false, checkOfacAlert: false,
        },
        update: {
          decision: "APPROVED", tier: PreQualTier.GOOD,
          maxOtdAmountCents: maxOtd, expiresAt, checkOfacAlert: false,
        },
      });
      // Also complete onboarding if not done
      if (!buyer.onboardingComplete) {
        await prisma.buyer.update({
          where: { id: buyerId },
          data: { onboardingComplete: true, termsAcceptedAt: new Date() },
        });
      }
      action = "JOURNEY_COMPLETE_PREQUAL";
      break;
    }

    // search — access derived from prequal, no separate DB record
    case "search":
      action = "JOURNEY_COMPLETE_SEARCH";
      break;

    // shortlist — cannot create items without a vehicle ID; admin unlock gives access
    case "shortlist":
      action = "JOURNEY_COMPLETE_SHORTLIST";
      break;

    // deposit — create PAID deposit record (mirrors deposit/override route)
    case "deposit": {
      const existing = await prisma.deposit.findFirst({
        where: { buyerId, status: "PAID" },
        select: { id: true },
      });
      if (!existing) {
        await prisma.deposit.create({
          data: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID" },
        });
      }
      action = "JOURNEY_COMPLETE_DEPOSIT";
      break;
    }

    // auction — requires live auction + offers; admin unlock gives access
    case "auction":
      action = "JOURNEY_COMPLETE_AUCTION";
      break;

    // select-deal — requires buyer to have selected an offer; admin unlock gives access
    case "select-deal":
      action = "JOURNEY_COMPLETE_SELECT_DEAL";
      break;

    // financing — set deal.financingPath = "EXTERNAL", advance to FEE_PENDING
    case "financing": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { financingPath: "EXTERNAL" },
      });
      // Advance deal status to FEE_PENDING if still in FINANCING_PENDING
      if (activeDeal.status === "FINANCING_PENDING") {
        await advanceDeal("FEE_PENDING");
      }
      action = "JOURNEY_COMPLETE_FINANCING";
      break;
    }

    // fee — mirrors concierge-fee/mark-paid route: feePaidAt + status = FEE_PAID
    case "fee": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      if (activeDeal.feePaidAt) {
        // Already paid — just ensure status is correct
        await prisma.deal.update({
          where: { id: activeDeal.id },
          data: { status: "FEE_PAID" },
        });
      } else {
        await prisma.deal.update({
          where: { id: activeDeal.id },
          data: { feePaidAt: new Date(), feeAmountCents: 49900, status: "FEE_PAID" },
        });
      }
      action = "JOURNEY_COMPLETE_FEE";
      break;
    }

    // insurance — set insuranceStatus = VERIFIED, advance to CONTRACT_PENDING
    case "insurance": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { insuranceStatus: "VERIFIED" },
      });
      await advanceDeal("CONTRACT_PENDING");
      action = "JOURNEY_COMPLETE_INSURANCE";
      break;
    }

    // contract — set contractShieldStatus = PASS, advance to SIGNING_PENDING
    case "contract": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { contractShieldStatus: "PASS" },
      });
      await advanceDeal("SIGNING_PENDING");
      action = "JOURNEY_COMPLETE_CONTRACT";
      break;
    }

    // sign — advance deal to PICKUP_SCHEDULED
    case "sign": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await advanceDeal("PICKUP_SCHEDULED");
      action = "JOURNEY_COMPLETE_SIGN";
      break;
    }

    // pickup — create/update Pickup record + advance deal to COMPLETED
    case "pickup": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      const existingPickup = await prisma.pickup.findUnique({
        where: { dealId: activeDeal.id },
        select: { id: true },
      });
      if (existingPickup) {
        await prisma.pickup.update({
          where: { dealId: activeDeal.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      } else {
        await prisma.pickup.create({
          data: { dealId: activeDeal.id, status: "COMPLETED", completedAt: new Date() },
        });
      }
      await advanceDeal("COMPLETED");
      action = "JOURNEY_COMPLETE_PICKUP";
      break;
    }

    default:
      return adminError("INVALID_STAGE", `Unknown stage: ${stageId}`, 400);
  }

  // Upsert a SKIP override so the stage shows as complete for the buyer immediately.
  // SKIP = admin bypassed/completed the step; buyer journey progression treats it as done.
  await prisma.adminJourneyUnlock.upsert({
    where: { buyerId_stageId: { buyerId, stageId } },
    create: { buyerId, stageId, type: "SKIP", adminId, adminEmail, note: note ?? null },
    update: { type: "SKIP", adminId, adminEmail, note: note ?? null },
  });

  // Audit log for the completion action
  await prisma.adminAuditLog.create({
    data: {
      adminId,
      adminEmail,
      action,
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { stageId, dealId: activeDeal?.id ?? null },
    },
  }).catch(() => {});

  return adminSuccess({ stageId, action, completed: true });
}
