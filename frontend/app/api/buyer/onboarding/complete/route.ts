// POST /api/buyer/onboarding/complete — finalize onboarding.
// Sets buyer.onboardingComplete=true, stamps termsAcceptedAt + termsVersion.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => ({}));
  const accepted = (body as { accepted?: boolean }).accepted === true;
  if (!accepted) {
    return errorResponse("TERMS_NOT_ACCEPTED", "Terms must be accepted to complete onboarding", 400);
  }

  // Onboarding now collects only profile preferences — address/DOB/employment
  // live on /buyer/prequal as a separate step. Only first/last name (set at
  // signup) are required to finalize onboarding.
  if (!buyer.firstName || !buyer.lastName) {
    return errorResponse("PROFILE_INCOMPLETE", "Complete your name before finalizing", 400);
  }

  const updated = await prisma.buyer.update({
    where: { id: buyer.id },
    data: {
      onboardingComplete: true,
      termsAcceptedAt: new Date(),
      termsVersion: process.env.CURRENT_TERMS_VERSION ?? "2026-01-01",
    },
    select: { onboardingComplete: true, termsAcceptedAt: true, termsVersion: true },
  });

  return successResponse(updated);
}
