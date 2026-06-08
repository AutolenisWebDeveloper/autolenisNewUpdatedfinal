// AutoLenis Social Engine — Hook A/B Testing Engine.
//
// Generates 3 hook variants in parallel for the same franchise+signal so the
// best-performing variant can be selected and promoted. In FULL_AUTO mode the
// orchestrator calls generateHookVariants() and schedules all 3, staggered 5
// minutes apart. selectWinningVariant() is called by the analytics sync cron
// once enough CTR data is available.

import type { ContentFranchise, TopicSignal } from "@prisma/client";
import type { PlatformConfig } from "@/lib/social/config";
import { generateSocialScript } from "@/lib/social/groq-script.engine";

export interface HookVariant {
  hookType: string;
  hook: string;
  caption: string;
  hashtags: string[];
  ctaText: string;
  score?: number;
}

const DEFAULT_HOOK_TYPES = ["fear", "curiosity", "savings"] as const;

export async function generateHookVariants(input: {
  franchise: ContentFranchise;
  signal: TopicSignal;
  platform: string;
  platformConfig: PlatformConfig;
}): Promise<HookVariant[]> {
  const { franchise, signal, platform, platformConfig } = input;

  // Pick 3 hook types: prefer franchise.hookTypes, pad with defaults.
  const franchiseHooks: string[] = Array.isArray(franchise.hookTypes) ? franchise.hookTypes : [];
  const pool = [...franchiseHooks, ...DEFAULT_HOOK_TYPES];
  const seen = new Set<string>();
  const hookTypes: string[] = [];
  for (const h of pool) {
    if (!seen.has(h)) { seen.add(h); hookTypes.push(h); }
    if (hookTypes.length === 3) break;
  }

  console.log("[hook-ab] generating", hookTypes.length, "variants for", franchise.slug, platform);

  const results = await Promise.allSettled(
    hookTypes.map((hookType) =>
      generateSocialScript({ franchise, signal, platform, hookType, platformConfig }),
    ),
  );

  const variants: HookVariant[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      variants.push({
        hookType: r.value.hookType,
        hook: r.value.hook,
        caption: r.value.caption,
        hashtags: r.value.hashtags,
        ctaText: r.value.ctaText,
      });
    } else {
      console.warn("[hook-ab] variant", hookTypes[i], "failed:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
  }

  console.log("[hook-ab] variants generated:", variants.length);
  return variants;
}

export function selectWinningVariant(
  variants: HookVariant[],
  performances: { hookType: string; ctr: number }[],
): HookVariant {
  if (variants.length === 0) throw new Error("No variants to select from");
  if (performances.length === 0) return variants[0];

  const perfMap = new Map(performances.map((p) => [p.hookType, p.ctr]));
  let best = variants[0];
  let bestCtr = perfMap.get(best.hookType) ?? -1;

  for (const v of variants.slice(1)) {
    const ctr = perfMap.get(v.hookType) ?? -1;
    if (ctr > bestCtr) { best = v; bestCtr = ctr; }
  }

  console.log("[hook-ab] winning variant:", best.hookType, "ctr:", bestCtr);
  return best;
}
