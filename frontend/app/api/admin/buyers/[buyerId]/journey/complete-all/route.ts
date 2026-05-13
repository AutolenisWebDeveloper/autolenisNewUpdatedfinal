// POST /api/admin/buyers/[buyerId]/journey/complete-all
// Completes all auto-completable stages in sequence via direct prisma calls.
// Stages requiring buyer action (auction, select-deal, shortlist) are handled
// via admin unlock records only. No internal HTTP fetch.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { moveBuyerWorkflowStage } from "@/lib/services/admin/admin-buyer-command-center.service";
import { DealStatus, PreQualTier } from "@prisma/client";

interface Props { params: Promise<{ buyerId: string }> }
const schema = z.object({ note: z.string().max(500).optional() });

const ALL_STAGES = [
  "account", "onboarding", "prequal", "search", "shortlist", "deposit",
  "auction", "select-deal", "financing", "fee", "insurance", "contract", "sign", "pickup",
] as const;

export async function POST(request: NextRequest, { params }: Props) {
  const adminResult = await getAdminFromRequest(request);
  if (!adminResult) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const admin = adminResult;

  const { buyerId } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const parsed = schema.safeParse(body);
  const note = parsed.success ? (parsed.data.note ?? "Admin completed entire journey") : "Admin completed entire journey";

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

  const activeDeal = buyer.deals[0] ?? null;
  const results: { stageId: string; success: boolean; error?: string }[] = [];

  async function advanceDeal(targetStatus: DealStatus) {
    if (!activeDeal) throw new Error("No active deal");
    await moveBuyerWorkflowStage(
      buyerId, admin.adminId, admin.email,
      activeDeal.id, targetStatus, note
    );
  }

  for (const stageId of ALL_STAGES) {
    try {
      switch (stageId) {
        case "account":
          break;

        case "onboarding":
          if (!buyer.onboardingComplete) {
            await prisma.buyer.update({
              where: { id: buyerId },
              data: { onboardingComplete: true, termsAcceptedAt: new Date() },
            });
          }
          break;

        case "prequal": {
          const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
          await prisma.preQualification.upsert({
            where: { buyerId },
            create: {
              buyerId, decision: "APPROVED", tier: PreQualTier.STRONG,
              maxOtdAmountCents: 5000000, expiresAt, isExternal: false, checkOfacAlert: false,
            },
            update: {
              decision: "APPROVED", tier: PreQualTier.STRONG,
              maxOtdAmountCents: 5000000, expiresAt, checkOfacAlert: false,
            },
          });
          break;
        }

        case "search":
        case "shortlist":
        case "auction":
        case "select-deal":
          // Depend on buyer action or live data — admin unlock record covers them
          break;

        case "deposit": {
          const existing = await prisma.deposit.findFirst({
            where: { buyerId, status: "PAID" }, select: { id: true },
          });
          if (!existing) {
            await prisma.deposit.create({
              data: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID" },
            });
          }
          break;
        }

        case "financing":
          if (activeDeal && !activeDeal.financingPath) {
            await prisma.deal.update({
              where: { id: activeDeal.id }, data: { financingPath: "EXTERNAL" },
            });
            if (activeDeal.status === "FINANCING_PENDING") {
              await advanceDeal(DealStatus.FEE_PENDING);
            }
          }
          break;

        case "fee":
          if (activeDeal && !activeDeal.feePaidAt) {
            await prisma.deal.update({
              where: { id: activeDeal.id },
              data: { feePaidAt: new Date(), feeAmountCents: 49900, status: "FEE_PAID" },
            });
          }
          break;

        case "insurance":
          if (activeDeal && activeDeal.insuranceStatus === "NOT_STARTED") {
            await prisma.deal.update({
              where: { id: activeDeal.id }, data: { insuranceStatus: "VERIFIED" },
            });
            await advanceDeal(DealStatus.CONTRACT_PENDING);
          }
          break;

        case "contract":
          if (activeDeal && activeDeal.contractShieldStatus !== "PASS") {
            await prisma.deal.update({
              where: { id: activeDeal.id }, data: { contractShieldStatus: "PASS" },
            });
            await advanceDeal(DealStatus.SIGNING_PENDING);
          }
          break;

        case "sign":
          if (activeDeal && !["PICKUP_SCHEDULED", "PICKUP_COMPLETE", "COMPLETED"].includes(activeDeal.status)) {
            await advanceDeal(DealStatus.PICKUP_SCHEDULED);
          }
          break;

        case "pickup":
          if (activeDeal && activeDeal.status !== "COMPLETED") {
            await advanceDeal(DealStatus.COMPLETED);
          }
          break;
      }

      await prisma.adminJourneyUnlock.upsert({
        where: { buyerId_stageId: { buyerId, stageId } },
        create: { buyerId, stageId, adminId: admin.adminId, adminEmail: admin.email, note },
        update: { adminId: admin.adminId, adminEmail: admin.email, note },
      });

      results.push({ stageId, success: true });
    } catch (err) {
      results.push({ stageId, success: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId, adminEmail: admin.email,
      action: "BUYER_JOURNEY_COMPLETE_ALL",
      entityType: "Buyer", entityId: buyerId,
      reason: note,
      metadata: { results, succeeded: results.filter(r => r.success).length },
    },
  }).catch(() => {});

  return adminSuccess({
    results,
    succeeded: results.filter(r => r.success).length,
    total: ALL_STAGES.length,
  });
}
