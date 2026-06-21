// POST /api/admin/buyers/[buyerId]/journey/complete-all
// Completes all auto-completable stages in sequence.
// Stages requiring buyer action (auction, select-deal, shortlist) are
// handled via admin unlock records only.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { PreQualTier } from "@prisma/client";
import { z } from "zod";
import { DEPOSIT_AMOUNT_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { moveBuyerWorkflowStage } from "@/lib/services/admin/admin-buyer-command-center.service";

interface Props { params: Promise<{ buyerId: string }> }
const schema = z.object({ note: z.string().max(500).optional() });

const ALL_STAGES = [
  "account","onboarding","prequal","search","shortlist","deposit",
  "auction","select-deal","financing","fee","insurance","contract","sign","pickup",
] as const;

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required to complete journey stages", 403);
  }

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
  const adminId = admin.adminId;
  const adminEmail = admin.email;

  async function advanceDeal(targetStatus: string) {
    if (!activeDeal) throw new Error("No active deal");
    await moveBuyerWorkflowStage(
      buyerId, adminId, adminEmail,
      activeDeal.id,
      targetStatus as Parameters<typeof moveBuyerWorkflowStage>[4],
      note,
      true, // deliberate admin journey progression — bypass the sequential guard
    );
  }

  // Execute each stage in sequence
  for (const stageId of ALL_STAGES) {
    try {
      switch (stageId) {
        case "account": break; // always complete

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
            create: { buyerId, decision: "APPROVED", tier: PreQualTier.GOOD, maxOtdAmountCents: 5000000, expiresAt, isExternal: false, checkOfacAlert: false },
            update: { decision: "APPROVED", tier: PreQualTier.GOOD, maxOtdAmountCents: 5000000, expiresAt, checkOfacAlert: false },
          });
          break;
        }

        case "search":
        case "shortlist":
        case "auction":
        case "select-deal":
          // These depend on buyer action or live data — admin unlock covers them
          break;

        case "deposit": {
          const existing = await prisma.deposit.findFirst({ where: { buyerId, status: "PAID" }, select: { id: true } });
          if (!existing) {
            await prisma.deposit.create({ data: { buyerId, amountCents: DEPOSIT_AMOUNT_CENTS, status: "PAID" } });
          }
          break;
        }

        case "financing":
          if (activeDeal && !activeDeal.financingPath) {
            await prisma.deal.update({ where: { id: activeDeal.id }, data: { financingPath: "EXTERNAL" } });
            if (activeDeal.status === "FINANCING_PENDING") await advanceDeal("FEE_PENDING");
          }
          break;

        case "fee":
          if (activeDeal && !activeDeal.feePaidAt) {
            // Record fee fields (non-status) directly; route the status change through the seam.
            await prisma.deal.update({
              where: { id: activeDeal.id },
              data: { feePaidAt: new Date(), feeAmountCents: PREMIUM_FEE_REMAINING_CENTS },
            });
            if (activeDeal.status !== "FEE_PAID") await advanceDeal("FEE_PAID");
          }
          break;

        case "insurance":
          if (activeDeal && activeDeal.insuranceStatus === "NOT_STARTED") {
            await prisma.deal.update({ where: { id: activeDeal.id }, data: { insuranceStatus: "VERIFIED" } });
            await advanceDeal("CONTRACT_PENDING");
          }
          break;

        case "contract":
          if (activeDeal && activeDeal.contractShieldStatus !== "PASS") {
            await prisma.deal.update({ where: { id: activeDeal.id }, data: { contractShieldStatus: "PASS" } });
            await advanceDeal("SIGNING_PENDING");
          }
          break;

        case "sign":
          if (activeDeal && !["PICKUP_SCHEDULED","PICKUP_COMPLETE","COMPLETED"].includes(activeDeal.status)) {
            await advanceDeal("PICKUP_SCHEDULED");
          }
          break;

        case "pickup":
          if (activeDeal && activeDeal.status !== "COMPLETED") {
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
          }
          break;
      }

      // Upsert SKIP override for every stage — complete-all marks all as bypassed/done
      await prisma.adminJourneyUnlock.upsert({
        where: { buyerId_stageId: { buyerId, stageId } },
        create: { buyerId, stageId, type: "SKIP", adminId, adminEmail, note },
        update: { type: "SKIP", adminId, adminEmail, note },
      });

      results.push({ stageId, success: true });
    } catch (err) {
      results.push({ stageId, success: false, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId, adminEmail,
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
