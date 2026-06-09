// AutoLenis Social Engine — Asset Recombination Engine (Option B).
//
// When a post goes viral, spin its winning concept into fresh variants along
// three axes: a different franchise, other platforms, and other metros. Each
// variant is generated and queued via the orchestrator so it flows through the
// normal review/publish pipeline.

import { prisma } from "@/lib/prisma";

export async function recombineViralAsset(post: {
  id: string;
  platform: string;
  hook: string;
  hookType: string | null;
  franchiseId: string | null;
  signalId: string | null;
  make: string | null;
  metro: string | null;
  script: string;
}): Promise<{ variants: { id: string }[]; strategies: string[] }> {
  const variants: { id: string }[] = [];
  const strategies: string[] = [];

  // Get the orchestrator dynamically to avoid circular imports.
  const { generateAndQueuePost } = await import(
    "@/lib/social/social-post.orchestrator"
  );

  // Get franchise and signal.
  const [franchise, signal] = await Promise.all([
    post.franchiseId
      ? prisma.contentFranchise.findUnique({ where: { id: post.franchiseId } })
      : null,
    post.signalId
      ? prisma.topicSignal.findUnique({ where: { id: post.signalId } })
      : null,
  ]);

  if (!franchise || !signal) {
    console.log("[recombine] missing franchise or signal — skipping");
    return { variants, strategies };
  }

  const now = new Date();

  // Strategy A: Same hook, different franchise.
  try {
    const otherFranchise = await prisma.contentFranchise.findFirst({
      where: {
        active: true,
        id: { not: franchise.id },
        platforms: { has: post.platform },
      },
      orderBy: { avgLeadScore: "desc" },
    });
    if (otherFranchise) {
      const scheduledAt = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const variant = await generateAndQueuePost({
        signal,
        franchise: otherFranchise,
        platform: post.platform,
        scheduledAt,
      }).catch(() => null);
      if (variant) {
        variants.push({ id: variant.id });
        strategies.push("Strategy A: same hook, different franchise");
      }
    }
  } catch (err) {
    console.error("[recombine] Strategy A failed:", err);
  }

  // Strategy C: Same content, different platforms.
  const otherPlatforms = ["tiktok", "instagram", "facebook", "linkedin"]
    .filter((p) => p !== post.platform)
    .slice(0, 2);

  for (const platform of otherPlatforms) {
    try {
      const scheduledAt = new Date(
        now.getTime() +
          (24 + otherPlatforms.indexOf(platform) * 12) * 60 * 60 * 1000,
      );
      const variant = await generateAndQueuePost({
        signal,
        franchise,
        platform,
        scheduledAt,
      }).catch(() => null);
      if (variant) {
        variants.push({ id: variant.id });
        strategies.push(`Strategy C: cross-platform → ${platform}`);
      }
    } catch (err) {
      console.error("[recombine] Strategy C failed:", err);
    }
  }

  // Strategy D: Same topic, different cities.
  const TARGET_METROS = ["Houston", "Austin", "Miami", "Atlanta", "Chicago"];
  const differentMetro = TARGET_METROS.find(
    (m) => m.toLowerCase() !== (post.metro ?? "").toLowerCase(),
  );

  if (differentMetro) {
    try {
      // Create a geo variant signal.
      const geoSignal = await prisma.topicSignal.create({
        data: {
          signalType: signal.signalType,
          make: signal.make,
          model: signal.model,
          city: differentMetro,
          metro: differentMetro,
          signalValue: signal.signalValue,
          signalContext: signal.signalContext as object,
          assetsGenerated: false,
          expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
      });
      const scheduledAt = new Date(now.getTime() + 48 * 60 * 60 * 1000);
      const variant = await generateAndQueuePost({
        signal: geoSignal,
        franchise,
        platform: post.platform,
        scheduledAt,
      }).catch(() => null);
      if (variant) {
        variants.push({ id: variant.id });
        strategies.push(`Strategy D: geo expansion → ${differentMetro}`);
      }
    } catch (err) {
      console.error("[recombine] Strategy D failed:", err);
    }
  }

  console.log(
    `[recombine] created ${variants.length} variants:`,
    strategies.join(", "),
  );

  return { variants, strategies };
}
