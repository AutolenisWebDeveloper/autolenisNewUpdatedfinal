import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { countAvailableItems } from "@/lib/services/shortlist/shortlist.service";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
import { computeJourney } from "@/lib/services/buyer/journey";
import { advanceOnInsuranceSatisfied } from "@/lib/services/deal/deal.service";

export const dynamic = "force-dynamic";

// Feature 3 — Journey status for Journey Navigator
export async function GET(request: NextRequest) {
  try {
    const buyer = await getRequestBuyer(request);
    if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

    // preQualification is already loaded on the buyer record (no Promise needed)
    const prequal = buyer.preQualification;

    const [shortlist, deposit, activeAuction, activeDeal, adminUnlocks] = await Promise.all([
      prisma.shortlist.findUnique({ where: { buyerId: buyer.id }, include: { items: true } }),
      prisma.deposit.findFirst({ where: { buyerId: buyer.id, status: "PAID" }, orderBy: { createdAt: "desc" } }),
      prisma.auction.findFirst({ where: { buyerId: buyer.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
      prisma.deal.findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } }),
      prisma.adminJourneyUnlock.findMany({
        where: { buyerId: buyer.id },
        select: { stageId: true, type: true },
      }),
    ]);

    // Self-heal the insurance gate on read (same idiom as ensureDealSigned): if a
    // deal is sitting at INSURANCE_PENDING with proof already on file, release it
    // into the contract stage. This converges deals that reached a satisfied
    // insurance state by a path that did not itself advance them. Idempotent and
    // non-throwing — a no-op for every deal that is not in exactly that state.
    // Attributed to SYSTEM, not BUYER: reading a status page is not the buyer
    // performing the transition.
    if (activeDeal?.status === "INSURANCE_PENDING") {
      await advanceOnInsuranceSatisfied(activeDeal.id);
    }

    // Single fact-derived machine (lib/services/buyer/journey) — same logic the
    // buyer layout uses, so the sidebar and this API can never disagree (M-3).
    const journey = computeJourney({
      onboardingComplete: buyer.onboardingComplete,
      prequalValid: isPrequalValid(prequal),
      // AVAILABLE candidates, not rows — the sidebar and this API share computeJourney,
      // so they must also share the definition of "has a shortlist".
      shortlistCount: shortlist ? await countAvailableItems(shortlist.items) : 0,
      depositPaid: !!deposit,
      activeAuction: !!activeAuction,
      deal: activeDeal
        ? {
            status: activeDeal.status,
            hasFinancingPath: !!activeDeal.financingPath,
            feePaid: !!activeDeal.feePaidAt,
            insuranceStatus: activeDeal.insuranceStatus,
            contractShieldPassed: activeDeal.contractShieldStatus === "PASS",
          }
        : null,
      overrides: adminUnlocks,
    });

    return successResponse({
      currentStage: journey.currentStage,
      completedStages: journey.completedStages,
      unlockedStages: journey.unlockedStages,
      nextAction: journey.nextAction,
    });
  } catch (err) {
    logger.error("[journey-status] Error:", err);
    return errorResponse("JOURNEY_STATUS_ERROR", "Unable to compute journey status", 500);
  }
}

