// POST /api/public/social-click
//
// Lightweight public click tracker. Fired client-side from the /lp/[campaign]
// landing pages when a visitor arrives via a social UTM, so we capture a
// CLICK-stage RevenueAttribution before any conversion. No auth required
// (CSRF is already skipped for /api/public/* in proxy.ts). Never errors —
// click tracking must be silent and never affect the page.

import { logger } from "@/lib/logger";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      utmHook?: string;
      utmPlatform?: string;
      creatorId?: string;
      affiliateId?: string;
      landingPage?: string;
    };

    // Only track social traffic
    const socialSources = ["facebook", "instagram", "tiktok", "youtube", "linkedin"];
    const source = (body.utmSource ?? "").toLowerCase();
    if (!socialSources.includes(source)) {
      return NextResponse.json({ tracked: false });
    }

    // Require a post-identifying UTM. Without this, an absent campaign+content
    // collapses the lookup to "most recent PUBLISHED post" and would attribute a
    // forged/empty click to an unrelated post, polluting attribution data.
    if (!body.utmCampaign && !body.utmContent) {
      return NextResponse.json({ tracked: false, reason: "missing_utm" });
    }

    // Find the social post this click came from
    const post = await prisma.socialPost
      .findFirst({
        where: {
          utmCampaign: body.utmCampaign ?? undefined,
          utmContent: body.utmContent ?? undefined,
          status: "PUBLISHED",
        },
        select: { id: true },
        orderBy: { publishedAt: "desc" },
      })
      .catch(() => null);

    if (!post) {
      // No post found — still acknowledge the click signal
      return NextResponse.json({ tracked: false, reason: "no_post_match" });
    }

    // Create CLICK-stage attribution record
    await prisma.revenueAttribution.create({
      data: {
        postId: post.id,
        utmSource: body.utmSource,
        utmCampaign: body.utmCampaign,
        utmContent: body.utmContent,
        utmHook: body.utmHook,
        utmPlatform: body.utmPlatform ?? body.utmSource,
        creatorId: body.creatorId ?? null,
        affiliateId: body.affiliateId ?? null,
        attributionStatus: "CLICK",
        clickedAt: new Date(),
      },
    });

    // Update SocialPerformance linkClicks — non-fatal
    await prisma.socialPerformance
      .updateMany({
        where: { postId: post.id },
        data: { linkClicks: { increment: 1 } },
      })
      .catch(() => {});

    logger.info("[social-click] tracked click for post:", post.id, source);
    return NextResponse.json({ tracked: true, postId: post.id });
  } catch (err) {
    // Never error — click tracking must be silent
    logger.error("[social-click] failed:", err);
    return NextResponse.json({ tracked: false });
  }
}
