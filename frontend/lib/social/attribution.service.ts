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
