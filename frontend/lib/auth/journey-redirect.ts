// Centralised buyer journey redirect helper.
// Computes the "next step" URL for an authenticated buyer based on their
// current journey state.  Used by:
//   - app/(public)/page.tsx  — redirects authenticated buyers away from homepage
//   - Any future server component / middleware that needs the same logic
//
// Mirrors the stage computation in app/buyer/layout.tsx.

import { prisma } from "@/lib/prisma";

interface BuyerJourneyInput {
  id: string;
  onboardingComplete: boolean;
  preQualification?: {
    decision: string;
    expiresAt: Date;
  } | null;
}

// URL for each journey stage
const STAGE_URL: Record<string, string> = {
  onboarding: "/buyer/onboarding",
  prequal: "/buyer/prequal",
  search: "/buyer/search",
  shortlist: "/buyer/shortlist",
  deposit: "/buyer/deposit",
  auction: "/buyer/auctions",
  "select-deal": "/buyer/auctions",
  financing: "/buyer/deal/financing",
  fee: "/buyer/fee",
  insurance: "/buyer/insurance",
  contract: "/buyer/contracts",
  sign: "/buyer/esign",
  pickup: "/buyer/pickup",
};

/**
 * Returns the URL the buyer should be taken to next given their current
 * journey stage.  Falls back to /buyer/dashboard if the stage is unknown.
 */
export async function getBuyerJourneyUrl(buyer: BuyerJourneyInput): Promise<string> {
  const prequal = buyer.preQualification ?? null;
  const prequalApproved =
    !!prequal &&
    prequal.decision === "APPROVED" &&
    prequal.expiresAt > new Date();

  const onboardingComplete = buyer.onboardingComplete === true || prequalApproved;

  if (!onboardingComplete) return STAGE_URL.onboarding;
  if (!prequalApproved) return STAGE_URL.prequal;

  // Shortlist check
  let shortlistCount = 0;
  try {
    const shortlist = await prisma.shortlist.findUnique({
      where: { buyerId: buyer.id },
      select: { _count: { select: { items: true } } },
    });
    shortlistCount = shortlist?._count.items ?? 0;
  } catch {
    // Non-fatal
  }

  if (shortlistCount === 0) return STAGE_URL.search;

  // Active deal check
  let activeDeal: { status: string } | null = null;
  try {
    activeDeal = await prisma.deal.findFirst({
      where: { buyerId: buyer.id },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
  } catch {
    // Non-fatal
  }

  if (!activeDeal) return STAGE_URL.shortlist;

  const s = activeDeal.status;
  if (s === "PENDING" || s === "ACTIVE") return STAGE_URL.deposit;
  if (s === "FINANCING_PENDING") return STAGE_URL.financing;
  if (s === "FEE_PENDING" || s === "FEE_PAID") return STAGE_URL.fee;
  if (s === "INSURANCE_PENDING") return STAGE_URL.insurance;
  if (s === "CONTRACT_PENDING" || s === "CONTRACT_REVIEW" || s === "CONTRACT_APPROVED") return STAGE_URL.contract;
  if (s === "SIGNING_PENDING" || s === "SIGNED") return STAGE_URL.sign;
  if (s === "PICKUP_SCHEDULED" || s === "PICKUP_COMPLETE" || s === "COMPLETED") return STAGE_URL.pickup;

  return "/buyer/dashboard";
}
