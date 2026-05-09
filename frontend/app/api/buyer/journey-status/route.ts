import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Feature 3 — Journey status for Journey Navigator
export async function GET(request: NextRequest) {
  try {
    const buyer = await getRequestBuyer(request);
    if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

    // preQualification is already loaded on the buyer record (no Promise needed)
    const prequal = buyer.preQualification;

    const [shortlist, deposit, activeAuction, activeDeal] = await Promise.all([
      prisma.shortlist.findUnique({ where: { buyerId: buyer.id }, include: { items: true } }),
      prisma.deposit.findFirst({ where: { buyerId: buyer.id, status: "PAID" }, orderBy: { createdAt: "desc" } }),
      prisma.auction.findFirst({ where: { buyerId: buyer.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } }),
      prisma.deal.findFirst({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } }),
    ]);

    const completedStages: string[] = ["account"];
    let currentStage = "onboarding";

    if (buyer.onboardingComplete) {
      completedStages.push("onboarding");
      currentStage = "prequal";
    }
    if (prequal) {
      completedStages.push("prequal");
      currentStage = "search";
    }
    if (shortlist && shortlist.items.length > 0) {
      completedStages.push("search", "shortlist");
      currentStage = "deposit";
    }
    if (deposit) {
      completedStages.push("deposit");
      currentStage = "auction";
    }
    if (activeAuction) {
      currentStage = "auction";
    }
    if (activeDeal) {
      completedStages.push("auction", "select-deal");
      currentStage = "financing";
      if (activeDeal.financingPath) currentStage = "fee";
      if (activeDeal.feePaidAt) { completedStages.push("financing", "fee"); currentStage = "insurance"; }
      if (activeDeal.insuranceStatus !== "NOT_STARTED") { completedStages.push("insurance"); currentStage = "contract"; }
      if (activeDeal.contractShieldStatus === "PASS") { completedStages.push("contract"); currentStage = "sign"; }
      if (activeDeal.status === "SIGNING_PENDING" || activeDeal.status === "SIGNED") { currentStage = "sign"; }
      if (activeDeal.status === "PICKUP_SCHEDULED") { completedStages.push("sign"); currentStage = "pickup"; }
      if (activeDeal.status === "COMPLETED") {
        completedStages.push("sign", "pickup");
        currentStage = "complete";
      }
    }

    return successResponse({
      currentStage,
      completedStages: Array.from(new Set(completedStages)),
      nextAction: getNextAction(currentStage),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[journey-status] Error:", err);
    return errorResponse("JOURNEY_STATUS_ERROR", "Unable to compute journey status", 500);
  }
}

function getNextAction(stage: string): string {
  const map: Record<string, string> = {
    onboarding: "Complete your profile",
    prequal: "Check your buying power",
    search: "Browse inventory",
    shortlist: "Add vehicles to shortlist",
    deposit: "Activate your auction ($99)",
    auction: "Monitor your live auction",
    "select-deal": "Review your offers",
    financing: "Choose your financing path",
    fee: "Pay the concierge fee",
    insurance: "Arrange insurance coverage",
    contract: "Review your contract",
    sign: "Sign your documents",
    pickup: "Pick up your vehicle",
    complete: "Your deal is complete",
  };
  return map[stage] ?? "Continue your journey";
}
