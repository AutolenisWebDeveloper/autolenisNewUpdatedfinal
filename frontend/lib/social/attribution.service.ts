// AutoLenis Social Engine — UTM Attribution Service.
//
// Links a vehicle request back to the SocialPost that drove it, via UTM
// parameters captured on the request-vehicle intake flow. Creates a
// RevenueAttribution record and increments the post's lead score.

import { prisma } from "@/lib/prisma";

const SOCIAL_SOURCES = new Set(["facebook", "instagram", "tiktok", "youtube", "linkedin"]);

export interface UtmAttributionInput {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  utmHook?: string;
  utmPlatform?: string;
  vehicleRequestId: string;
  buyerOpportunityId: string;
}

export async function captureUtmAttribution(input: UtmAttributionInput): Promise<void> {
  const source = input.utmSource?.toLowerCase() ?? "";
  if (!SOCIAL_SOURCES.has(source)) return;

  const post = await prisma.socialPost.findFirst({
    where: {
      utmCampaign: input.utmCampaign ?? undefined,
      utmContent: input.utmContent ?? undefined,
      status: "PUBLISHED",
    },
    orderBy: { publishedAt: "desc" },
  });

  if (!post) {
    console.log("[attribution] no post found for utm_campaign:", input.utmCampaign, "utm_content:", input.utmContent);
    return;
  }

  try {
    await prisma.revenueAttribution.create({
      data: {
        postId: post.id,
        vehicleRequestId: input.vehicleRequestId,
        utmSource: input.utmSource,
        utmCampaign: input.utmCampaign,
        utmContent: input.utmContent,
        utmHook: input.utmHook,
        utmPlatform: input.utmPlatform,
        attributionStatus: "REQUEST",
        requestedAt: new Date(),
      },
    });
  } catch (err) {
    console.warn("[attribution] revenueAttribution.create failed (non-fatal):", err instanceof Error ? err.message : err);
  }

  // Update SocialPerformance — best-effort, row may not exist yet.
  const perf = await prisma.socialPerformance.findFirst({
    where: { postId: post.id },
    orderBy: { createdAt: "desc" },
  });
  if (perf) {
    await prisma.socialPerformance
      .update({
        where: { id: perf.id },
        data: {
          vehicleRequests: { increment: 1 },
          leadScore: { increment: 10 },
        },
      })
      .catch(() => undefined);
  }

  await prisma.socialPost
    .update({ where: { id: post.id }, data: { leadScore: { increment: 10 } } })
    .catch(() => undefined);

  console.log("[attribution] vehicle request attributed to post:", post.id);
}

// Closes the revenue-attribution loop when a deal is won: promotes the social
// post's RevenueAttribution chain (CLICK/REQUEST → DEAL_WON), records the
// deposit/fee/total, bumps the post's lead score + performance deal counters,
// and marks any matching SocialLead converted. All writes are best-effort so a
// downstream failure never blocks the deal flow.
export async function captureDealAttribution(input: {
  dealId: string;
  vehicleRequestId: string;
  depositAmountCents?: number;
  feeAmountCents?: number;
  totalRevenueCents?: number;
}): Promise<void> {
  try {
    // Find attribution chain from this vehicle request
    const attribution = await prisma.revenueAttribution.findFirst({
      where: {
        vehicleRequestId: input.vehicleRequestId,
        attributionStatus: { in: ["CLICK", "REQUEST"] },
      },
      include: { post: true },
    });

    if (!attribution) {
      console.log(
        "[attribution] no social attribution found for:",
        input.vehicleRequestId,
      );
      return;
    }

    // Update attribution to DEAL_WON
    await prisma.revenueAttribution.update({
      where: { id: attribution.id },
      data: {
        attributionStatus: "DEAL_WON",
        dealId: input.dealId,
        depositAmountCents: input.depositAmountCents,
        feeAmountCents: input.feeAmountCents,
        totalRevenueCents: input.totalRevenueCents,
        dealWonAt: new Date(),
      },
    });

    // Update SocialPost lead score
    await prisma.socialPost
      .update({
        where: { id: attribution.postId },
        data: { leadScore: { increment: 50 } },
      })
      .catch(() => undefined);

    // Update SocialPerformance — increment dealsWon + revenue
    await prisma.socialPerformance
      .updateMany({
        where: { postId: attribution.postId },
        data: {
          dealsWon: { increment: 1 },
          revenueGenerated: { increment: input.totalRevenueCents ?? 0 },
        },
      })
      .catch(() => undefined);

    // Update SocialLead if exists
    const lead = await prisma.socialLead
      .findFirst({ where: { vehicleRequestId: input.vehicleRequestId } })
      .catch(() => null);

    if (lead) {
      await prisma.socialLead
        .update({
          where: { id: lead.id },
          data: { convertedAt: new Date(), status: "CONVERTED" },
        })
        .catch(() => undefined);
    }

    console.log(
      "[attribution] 🎉 deal won attributed to post:",
      attribution.postId,
      `revenue: $${((input.totalRevenueCents ?? 0) / 100).toFixed(2)}`,
    );
  } catch (err) {
    console.error(
      "[attribution] captureDealAttribution failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
