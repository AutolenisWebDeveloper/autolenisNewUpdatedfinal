// AutoLenis Social Engine — Creator content-package generator.
//
// Builds a weekly "ready to share" package for each active creator in the
// network: the top organic posts from the last 7 days on the creator's
// platform, each with a tracked URL rebuilt to carry the creator's attribution
// (utm_creator + utm_affiliate), plus a personalized email body. Distribution
// emails the package via the shared Resend rail.

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { buildUtmUrl } from "@/lib/social/config";

export interface CreatorPackage {
  creatorId: string;
  weekOf: string;
  posts: {
    platform: string;
    caption: string;
    hashtags: string[];
    trackedUrl: string;
    imageUrl?: string;
    videoUrl?: string;
    instructions: string;
  }[];
  emailBody: string;
}

export async function generateCreatorPackage(creator: {
  id: string;
  name: string;
  platform: string;
  commissionRate: number | null;
  affiliateId: string | null;
}): Promise<CreatorPackage> {
  // Find top 3 published posts from last 7 days for creator's platform. Only
  // PUBLISHED posts qualify: APPROVED posts have a null publishedAt and so could
  // never satisfy the publishedAt filter — listing them in the status filter was
  // dead and misleading.
  const topPosts = await prisma.socialPost.findMany({
    where: {
      platform: creator.platform,
      status: "PUBLISHED",
      publishedAt: {
        gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { leadScore: "desc" },
    take: 3,
    include: {
      franchise: true,
      video: true,
    },
  });

  const weekOf = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const posts = topPosts.map((post) => {
    // Rebuild tracked URL with creator attribution
    const trackedUrl = buildUtmUrl({
      path: post.funnelDestination ?? "/request-a-car",
      platform: post.platform,
      franchise: post.franchise?.slug ?? "autolenis",
      hookType: post.hookType ?? "social_proof",
      contentType: post.contentType,
      city: post.metro ?? undefined,
      make: post.make ?? undefined,
      creatorId: creator.id,
      affiliateId: creator.affiliateId ?? undefined,
    });

    return {
      platform: post.platform,
      caption: post.caption,
      hashtags: post.hashtags,
      trackedUrl,
      imageUrl: post.video?.thumbnailUrl ?? undefined,
      videoUrl: post.video?.videoUrl ?? undefined,
      instructions:
        `Post this to your ${post.platform} account. ` +
        `Your custom tracking link is included in the caption. ` +
        `Every vehicle request you drive earns you ` +
        `${creator.commissionRate ?? 0}% commission when a deal closes.`,
    };
  });

  const emailBody =
    `Hi ${creator.name},\n\n` +
    `Here are this week's top AutoLenis posts ready to share ` +
    `(week of ${weekOf}).\n\n` +
    `Your custom links are already built in — every request ` +
    `you drive is tracked to your account.\n\n` +
    `Commission rate: ${creator.commissionRate ?? 0}%\n` +
    `Questions? Reply to this email.\n\n` +
    `— The AutoLenis Team`;

  return { creatorId: creator.id, weekOf, posts, emailBody };
}

export async function distributeCreatorPackages(): Promise<void> {
  const creators = await prisma.creatorNetwork.findMany({
    where: { status: "ACTIVE" },
  });

  if (creators.length === 0) {
    logger.info("[creator-dist] no active creators");
    return;
  }

  const { sendCreatorPackageEmail } = await import(
    "@/lib/services/email/resend.service"
  );

  let sent = 0;
  for (const creator of creators) {
    try {
      const pkg = await generateCreatorPackage(creator);
      if (creator.email) {
        await sendCreatorPackageEmail({
          to: creator.email,
          name: creator.name,
          weekOf: pkg.weekOf,
          postsCount: pkg.posts.length,
          emailBody: pkg.emailBody,
        });
      }
      logger.info(
        `[creator-dist] package ready for: ${creator.name}`,
        `${pkg.posts.length} posts`,
      );
      sent++;
    } catch (err) {
      logger.error("[creator-dist] failed for creator:", creator.id, err);
    }
  }

  logger.info(`[creator-dist] distributed ${sent} packages`);
}
