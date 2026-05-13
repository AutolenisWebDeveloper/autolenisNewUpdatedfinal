// POST /api/admin/buyers/[buyerId]/journey/complete
// Marks a buyer journey stage as organically complete by writing real DB records.
// Uses moveBuyerWorkflowStage for deal transitions — handles DealStatusHistory
// with actorId/actorRole correctly and writes AdminAuditLog.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { moveBuyerWorkflowStage } from "@/lib/services/admin/admin-buyer-command-center.service";
import { DealStatus, PreQualTier } from "@prisma/client";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  stageId: z.enum([
    "account", "onboarding", "prequal", "search", "shortlist", "deposit",
    "auction", "select-deal", "financing", "fee", "insurance",
    "contract", "sign", "pickup",
  ]),
  note:              z.string().max(500).optional(),
  maxOtdAmountCents: z.number().int().positive().optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { buyerId } = await params;
  // Capture as non-null — already guarded above
  const adminPayload = admin;
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

  async function advanceDeal(targetStatus: DealStatus) {
    if (!activeDeal) throw new Error("No active deal found for this buyer");
    await moveBuyerWorkflowStage(
      buyerId,
      adminPayload.adminId,
      adminPayload.email,
      activeDeal.id,
      targetStatus,
      reason
    );
  }

  let action: string;

  switch (stageId) {

    case "account":
      action = "JOURNEY_COMPLETE_ACCOUNT";
      break;

    case "onboarding":
      await prisma.buyer.update({
        where: { id: buyerId },
        data: { onboardingComplete: true, termsAcceptedAt: new Date() },
      });
      action = "JOURNEY_COMPLETE_ONBOARDING";
      break;

    case "prequal": {
      const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      const maxOtd = maxOtdAmountCents ?? 5000000;
      await prisma.preQualification.upsert({
        where: { buyerId },
        create: {
          buyerId, decision: "APPROVED", tier: PreQualTier.STRONG,
          maxOtdAmountCents: maxOtd, expiresAt,
          isExternal: false, checkOfacAlert: false,
        },
        update: {
          decision: "APPROVED", tier: PreQualTier.STRONG,
          maxOtdAmountCents: maxOtd, expiresAt, checkOfacAlert: false,
        },
      });
      if (!buyer.onboardingComplete) {
        await prisma.buyer.update({
          where: { id: buyerId },
          data: { onboardingComplete: true, termsAcceptedAt: new Date() },
        });
      }
      action = "JOURNEY_COMPLETE_PREQUAL";
      break;
    }

    case "search":
      action = "JOURNEY_COMPLETE_SEARCH";
      break;

    case "shortlist":
      action = "JOURNEY_COMPLETE_SHORTLIST";
      break;

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

    case "auction":
      action = "JOURNEY_COMPLETE_AUCTION";
      break;

    case "select-deal":
      action = "JOURNEY_COMPLETE_SELECT_DEAL";
      break;

    case "financing": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { financingPath: "EXTERNAL" },
      });
      if (activeDeal.status === "FINANCING_PENDING") {
        await advanceDeal(DealStatus.FEE_PENDING);
      }
      action = "JOURNEY_COMPLETE_FINANCING";
      break;
    }

    // Mirrors concierge-fee/mark-paid: feePaidAt + status = FEE_PAID
    case "fee": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: {
          feePaidAt: activeDeal.feePaidAt ?? new Date(),
          feeAmountCents: 49900,
          status: "FEE_PAID",
        },
      });
      action = "JOURNEY_COMPLETE_FEE";
      break;
    }

    case "insurance": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { insuranceStatus: "VERIFIED" },
      });
      await advanceDeal(DealStatus.CONTRACT_PENDING);
      action = "JOURNEY_COMPLETE_INSURANCE";
      break;
    }

    case "contract": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await prisma.deal.update({
        where: { id: activeDeal.id },
        data: { contractShieldStatus: "PASS" },
      });
      await advanceDeal(DealStatus.SIGNING_PENDING);
      action = "JOURNEY_COMPLETE_CONTRACT";
      break;
    }

    case "sign": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await advanceDeal(DealStatus.PICKUP_SCHEDULED);
      action = "JOURNEY_COMPLETE_SIGN";
      break;
    }

    case "pickup": {
      if (!activeDeal) return adminError("NO_DEAL", "No active deal found", 400);
      await advanceDeal(DealStatus.COMPLETED);
      action = "JOURNEY_COMPLETE_PICKUP";
      break;
    }

    default:
      return adminError("INVALID_STAGE", `Unknown stage: ${stageId}`, 400);
  }

  // Upsert admin unlock so stage appears accessible to the buyer immediately
  await prisma.adminJourneyUnlock.upsert({
    where: { buyerId_stageId: { buyerId, stageId } },
    create: { buyerId, stageId, adminId: adminPayload.adminId, adminEmail: adminPayload.email, note: note ?? null },
    update: { adminId: adminPayload.adminId, adminEmail: adminPayload.email, note: note ?? null },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: adminPayload.adminId,
      adminEmail: adminPayload.email,
      action,
      entityType: "Buyer",
      entityId: buyerId,
      reason,
      metadata: { stageId, dealId: activeDeal?.id ?? null },
    },
  }).catch(() => {});

  return adminSuccess({ stageId, action, completed: true });
}
