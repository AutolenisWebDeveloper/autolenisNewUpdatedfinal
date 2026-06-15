import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { requestPayout } from "@/lib/services/affiliate/affiliate-payout.service";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const [payoutMethod, taxProfile] = await Promise.all([
    prisma.affiliatePayoutMethod.findUnique({
      where: { affiliateId: affiliate.id },
      select: { method: true },
    }),
    prisma.affiliateTaxProfile.findUnique({
      where: { affiliateId: affiliate.id },
      select: { certified: true },
    }),
  ]);

  const missing: string[] = [];
  if (!payoutMethod?.method) missing.push("banking");
  if (!taxProfile?.certified) missing.push("tax");
  if (affiliate.status !== "ACTIVE") missing.push("onboarding");

  if (missing.length > 0) {
    return errorResponse(
      "PREREQUISITES_MISSING",
      `Complete the following before requesting a payout: ${missing.join(", ")}`,
      412
    );
  }

  try {
    const payout = await requestPayout(affiliate.id);

    await prisma.notification.create({
      data: {
        type: "PAYOUT_REQUESTED",
        title: "Affiliate Payout Requested",
        body: `Affiliate ${affiliate.user?.email ?? affiliate.id} has requested a payout of $${(payout.amountCents / 100).toFixed(2)}.`,
        metadata: JSON.stringify({
          affiliateId: affiliate.id,
          payoutId: payout.id,
          amountCents: payout.amountCents,
        }),
      },
    }).catch(err => {
      logger.error("[affiliate/payouts/request] Failed to create admin notification:", err);
    });

    return successResponse({ payout }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse("PAYOUT_ERROR", msg, 400);
  }
}
