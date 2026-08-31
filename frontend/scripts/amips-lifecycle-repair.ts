#!/usr/bin/env tsx
/**
 * amips-lifecycle-repair — restore AMIPS pages demoted by the lifecycle defects
 * corrected in this batch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  NOT EXECUTED BY THIS BATCH. Produced for owner review only.
 *
 *  RUN ORDER IS NOT OPTIONAL. This script must run AFTER the code fixes are
 *  deployed. Running it first re-demotes everything on the next Tuesday
 *  lifecycle run (0 4 * * 2), because the branches that demoted these pages
 *  would still be live.
 *
 *      1. deploy the code fixes in this batch
 *      2. verify a lifecycle run is clean (dry-run this script, expect stable
 *         counts across two consecutive runs)
 *      3. pnpm tsx scripts/amips-lifecycle-repair.ts            (dry run)
 *      4. pnpm tsx scripts/amips-lifecycle-repair.ts --apply    (writes)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IT REPAIRS
 *
 *  A. REFRESH_REQUIRED pages (production: 208, all Tier C).
 *     These were demoted because Tier C market data ages past 30 days and
 *     nothing refreshes it. After FIX 3 REFRESH_REQUIRED is servable, so these
 *     pages are already live again without any data change — they are reported
 *     here for visibility and NOT rewritten. Restoring them to ACTIVE would
 *     falsely assert their data is fresh.
 *
 *  B. UNDER_REVIEW pages demoted as duplicates (production: 31, all Tier C).
 *     Exactly one page per (make, model, metro) cluster is promoted back to
 *     ACTIVE — the canonical — and the rest stay UNDER_REVIEW. Restoring all of
 *     them would recreate the duplicate cluster the lifecycle manager correctly
 *     resolved.
 *
 * WHY quality_gate_status IS THE MARKER
 *  None of the three lifecycle writers touches quality_gate_status, so
 *  quality_gate_status = 'PUBLISHED' identifies a page the GENERATOR certified
 *  (gate 5/5) that was demoted afterwards. A page with REVIEW_NEEDED was never
 *  ACTIVE and is out of scope — it is awaiting human review on its own merits.
 *
 * CANONICAL SELECTION
 *  Ranked by: impressions desc, then clicks desc, then published_at asc.
 *  With production impressions and clicks both zero corpus-wide this resolves to
 *  earliest published_at — the same page the lifecycle manager already kept
 *  ACTIVE, so in the common case the cluster's canonical is already live and
 *  NOTHING is promoted. A cluster only yields a promotion when every member was
 *  demoted, which is the case this script exists to repair.
 *
 * SAFETY
 *  - Dry run by default. Writes only with --apply.
 *  - Idempotent: re-running after an apply is a no-op (already-ACTIVE canonicals
 *    are skipped), so a partial failure is resumable.
 *  - Every transition is logged before it is written, and the full before-state
 *    is emitted as JSON for rollback — there is no history table, so this output
 *    IS the rollback record. Capture it.
 *  - Writes one page at a time; no bulk updateMany, so a mid-run failure leaves
 *    a consistent, partially-applied state that a re-run completes.
 */

import { prisma } from "@/lib/prisma";
import { LIFECYCLE_ACTIVE, LIFECYCLE_UNDER_REVIEW, LIFECYCLE_REFRESH_REQUIRED } from "@/lib/amips/tiers";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: string;
  slug: string;
  make: string | null;
  model: string | null;
  metro: string | null;
  contentTier: string;
  lifecycleStatus: string;
  qualityGateStatus: string;
  impressions: number;
  clicks: number;
  publishedAt: Date | null;
}

function clusterKey(r: Row): string | null {
  if (!r.make || !r.model || !r.metro) return null;
  return `${r.make}|${r.model}|${r.metro}`.toLowerCase();
}

/** impressions desc, clicks desc, published_at asc. Exported for testing. */
export function rankCanonical(a: Row, b: Row): number {
  if (b.impressions !== a.impressions) return b.impressions - a.impressions;
  if (b.clicks !== a.clicks) return b.clicks - a.clicks;
  const at = a.publishedAt ? a.publishedAt.getTime() : Number.POSITIVE_INFINITY;
  const bt = b.publishedAt ? b.publishedAt.getTime() : Number.POSITIVE_INFINITY;
  return at - bt;
}

async function main(): Promise<void> {
  console.log(`\n=== amips-lifecycle-repair — ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ===\n`);

  // Generator-certified pages that a lifecycle branch demoted afterwards.
  const demoted = (await prisma.amipsPage.findMany({
    where: {
      qualityGateStatus: "PUBLISHED",
      lifecycleStatus: { in: [LIFECYCLE_UNDER_REVIEW, LIFECYCLE_REFRESH_REQUIRED] },
    },
    select: {
      id: true, slug: true, make: true, model: true, metro: true,
      contentTier: true, lifecycleStatus: true, qualityGateStatus: true,
      impressions: true, clicks: true, publishedAt: true,
    },
  })) as Row[];

  // Rollback record. No history table exists — capture this output.
  console.log("--- BEFORE STATE (rollback record) ---");
  console.log(JSON.stringify(
    demoted.map((r) => ({ id: r.id, slug: r.slug, lifecycleStatus: r.lifecycleStatus })),
    null, 2,
  ));

  const refreshRequired = demoted.filter((r) => r.lifecycleStatus === LIFECYCLE_REFRESH_REQUIRED);
  const underReview = demoted.filter((r) => r.lifecycleStatus === LIFECYCLE_UNDER_REVIEW);

  console.log(`\n--- A. REFRESH_REQUIRED: ${refreshRequired.length} page(s) ---`);
  console.log("Servable again under FIX 3 with no data change. Not rewritten:");
  console.log("promoting them to ACTIVE would assert their market data is fresh when it is not.");
  console.log("They should be regenerated through the normal content queue instead.\n");

  console.log(`--- B. UNDER_REVIEW (duplicate demotions): ${underReview.length} page(s) ---`);

  // Cluster the demoted pages, then pull in any sibling that is already live so
  // a cluster with a live canonical is left alone.
  const clusters = new Map<string, Row[]>();
  for (const r of underReview) {
    const k = clusterKey(r);
    if (!k) {
      console.log(`  SKIP ${r.slug} — no make/model/metro, cannot have been a duplicate demotion`);
      continue;
    }
    clusters.set(k, [...(clusters.get(k) ?? []), r]);
  }

  let promoted = 0;
  let leftAlone = 0;

  for (const [key, members] of clusters) {
    const [make, model, metro] = key.split("|");
    const siblings = (await prisma.amipsPage.findMany({
      where: {
        make: { equals: make, mode: "insensitive" },
        model: { equals: model, mode: "insensitive" },
        metro: { equals: metro, mode: "insensitive" },
      },
      select: {
        id: true, slug: true, make: true, model: true, metro: true,
        contentTier: true, lifecycleStatus: true, qualityGateStatus: true,
        impressions: true, clicks: true, publishedAt: true,
      },
    })) as Row[];

    const liveCanonical = siblings.find((s) => s.lifecycleStatus === LIFECYCLE_ACTIVE);
    if (liveCanonical) {
      leftAlone += members.length;
      console.log(
        `  CLUSTER ${key}: canonical already live (${liveCanonical.slug}); ` +
        `leaving ${members.length} demoted sibling(s) as-is`,
      );
      continue;
    }

    // Every member demoted — promote exactly one.
    const canonical = [...siblings].sort(rankCanonical)[0];
    if (!canonical) continue;

    console.log(
      `  CLUSTER ${key}: no live canonical. ` +
      `PROMOTE ${canonical.slug} (${canonical.lifecycleStatus} -> ACTIVE); ` +
      `${siblings.length - 1} sibling(s) stay demoted`,
    );

    if (APPLY) {
      await prisma.amipsPage.update({
        where: { id: canonical.id },
        data: { lifecycleStatus: LIFECYCLE_ACTIVE },
      });
    }
    promoted++;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`REFRESH_REQUIRED reported (not rewritten): ${refreshRequired.length}`);
  console.log(`UNDER_REVIEW duplicate demotions examined: ${underReview.length}`);
  console.log(`clusters with a live canonical (untouched): ${leftAlone}`);
  console.log(`canonicals ${APPLY ? "promoted" : "that WOULD be promoted"}: ${promoted}`);
  if (!APPLY) console.log(`\nDry run — nothing written. Re-run with --apply to write.`);
}

main()
  .catch((err) => {
    console.error("[amips-lifecycle-repair] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
