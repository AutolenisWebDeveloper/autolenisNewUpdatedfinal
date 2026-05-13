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
  const { accepted, firstName: bodyFirstName, lastName: bodyLastName } =
    body as { accepted?: boolean; firstName?: string; lastName?: string };
  if (!accepted) {
    return errorResponse("TERMS_NOT_ACCEPTED", "Terms must be accepted to complete onboarding", 400);
  }

  // Save name if provided and not already set
  if (bodyFirstName && !buyer.firstName) {
    await prisma.buyer.update({
      where: { id: buyer.id },
      data: {
        firstName: String(bodyFirstName).trim(),
        lastName: String(bodyLastName ?? "").trim(),
      },
    });
    // Re-fetch to pick up newly saved name
    const refreshed = await prisma.buyer.findUnique({ where: { id: buyer.id }, select: { firstName: true, lastName: true } });
    if (!refreshed?.firstName || !refreshed?.lastName) {
      return errorResponse("PROFILE_INCOMPLETE", "Complete your name before finalizing", 400);
    }
  } else if (!buyer.firstName || !buyer.lastName) {
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
