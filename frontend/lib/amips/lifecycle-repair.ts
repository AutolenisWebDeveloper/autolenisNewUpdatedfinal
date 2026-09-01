// lib/amips/lifecycle-repair.ts — decision logic for repairing pages demoted by
// the lifecycle defects. Pure and side-effect free; scripts/amips-lifecycle-repair.ts
// supplies the I/O.
//
// Extracted from the script so the canonical-selection rule is unit-testable.
// The rule is exactly where the script was wrong: it asked whether a cluster had
// an ACTIVE sibling, when the question is whether it has a SERVABLE one.

import { isServableLifecycleStatus, LIFECYCLE_ACTIVE } from "@/lib/amips/tiers";

export interface RepairCandidate {
  id: string;
  slug: string;
  lifecycleStatus: string;
  impressions: number;
  clicks: number;
  publishedAt: Date | null;
}

export type ClusterAction =
  | { action: "skip"; reason: string; liveCanonical: RepairCandidate }
  | { action: "promote"; reason: string; canonical: RepairCandidate }
  | { action: "skip"; reason: string; liveCanonical: null };

/**
 * Canonical ranking: impressions desc, then clicks desc, then published_at asc.
 *
 * With production impressions and clicks both zero corpus-wide the first two
 * keys are inert and this resolves to earliest published_at — the same order the
 * lifecycle manager used when it chose which sibling to keep.
 */
export function rankCanonical(a: RepairCandidate, b: RepairCandidate): number {
  if (b.impressions !== a.impressions) return b.impressions - a.impressions;
  if (b.clicks !== a.clicks) return b.clicks - a.clicks;
  const at = a.publishedAt ? a.publishedAt.getTime() : Number.POSITIVE_INFINITY;
  const bt = b.publishedAt ? b.publishedAt.getTime() : Number.POSITIVE_INFINITY;
  return at - bt;
}

/**
 * Decide what to do with one (make, model, metro) cluster.
 *
 * THE CORRECTION THIS ENCODES
 * The first version asked `lifecycleStatus === "ACTIVE"`. Once REFRESH_REQUIRED
 * became servable that question stopped matching reality: a cluster whose
 * canonical is REFRESH_REQUIRED already has a LIVE page, so promoting a demoted
 * sibling would put two live pages on one entity — re-creating precisely the
 * duplication the lifecycle manager correctly resolved.
 *
 * This is the same ACTIVE-literal-vs-servability assumption that had to be
 * corrected in the clustering path; the script carried a second copy of it.
 *
 * Against owner-verified production — 0 of the 31 clusters have an ACTIVE
 * sibling, 31 of 31 have a REFRESH_REQUIRED sibling — every cluster returns
 * "skip". Zero promotions is the CORRECT output, not a failure.
 */
export function planClusterRepair(siblings: readonly RepairCandidate[]): ClusterAction {
  const liveCanonical = siblings.find((s) => isServableLifecycleStatus(s.lifecycleStatus));
  if (liveCanonical) {
    return {
      action: "skip",
      reason:
        liveCanonical.lifecycleStatus === LIFECYCLE_ACTIVE
          ? "canonical already live (ACTIVE)"
          : `canonical already live (${liveCanonical.lifecycleStatus} — servable)`,
      liveCanonical,
    };
  }

  const canonical = [...siblings].sort(rankCanonical)[0];
  if (!canonical) {
    return { action: "skip", reason: "empty cluster", liveCanonical: null };
  }
  return {
    action: "promote",
    reason: "cluster is fully dark — no servable sibling",
    canonical,
  };
}
