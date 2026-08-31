#!/usr/bin/env tsx
/**
 * amips-lifecycle-repair — restore AMIPS pages demoted by the lifecycle defects
 * corrected on this branch.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  NOT EXECUTED BY THIS BATCH. Produced for owner review only.
 *
 *  EXPECTED OUTPUT AGAINST OWNER-VERIFIED PRODUCTION: **PROMOTE NOTHING.**
 *
 *  Of the 31 UNDER_REVIEW + PUBLISHED pages, 0 clusters have an ACTIVE sibling
 *  and 31 have a REFRESH_REQUIRED sibling. Since FIX 3 made REFRESH_REQUIRED
 *  servable, every one of those clusters ALREADY HAS A LIVE CANONICAL, so the
 *  correct action for all 31 is to leave them demoted. Promoting any of them
 *  would put two live pages on one make+model+metro and re-create exactly the
 *  duplication the lifecycle manager correctly resolved.
 *
 *  A run that reports "0 promoted" is the script working, not the script
 *  failing. There is nothing to repair: FIX 3 already returned the 208
 *  REFRESH_REQUIRED pages to the index, and those pages ARE the canonicals.
 *
 *  An earlier version of this script asked `lifecycleStatus === "ACTIVE"` and
 *  would have promoted all 31 — the same ACTIVE-literal-vs-servability
 *  assumption that had to be corrected in the clustering path. The decision rule
 *  now lives in lib/amips/lifecycle-repair.ts and is unit-tested.
 *
 *  RUN ORDER IS NOT OPTIONAL — after the code fixes are deployed:
 *      1. deploy the code fixes on this branch
 *      2. pnpm tsx scripts/amips-lifecycle-repair.ts            (dry run)
 *      3. pnpm tsx scripts/amips-lifecycle-repair.ts --apply    (only if step 2
 *                                                                reports > 0)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * WHAT IT REPAIRS
 *
 *  A. REFRESH_REQUIRED pages (production: 208, all Tier C).
 *     Servable again under FIX 3 with no data change. Reported for visibility,
 *     never rewritten: promoting them to ACTIVE would assert their data is fresh
 *     when it is 66 days old. They should be regenerated through the content
 *     queue instead.
 *
 *  B. UNDER_REVIEW pages demoted as duplicates (production: 31, all Tier C).
 *     A canonical is promoted ONLY when its whole cluster is dark — i.e. no
 *     sibling is servable. See the expected output above.
 *
 * WHY quality_gate_status IS THE MARKER
 *  No lifecycle writer touches quality_gate_status, so 'PUBLISHED' identifies a
 *  page the GENERATOR certified (gate 5/5) that was demoted afterwards. A
 *  REVIEW_NEEDED page was never ACTIVE and is out of scope.
 *
 * SAFETY
 *  - Dry run by default; writes only with --apply.
 *  - Idempotent: a promoted canonical is servable, so a re-run skips its cluster.
 *  - Emits the full before-state as JSON. There is no history table, so that
 *    output IS the rollback record. Capture it.
 *  - One row at a time; a mid-run failure leaves a consistent state a re-run
 *    completes.
 */

import { prisma } from "@/lib/prisma";
import {
  LIFECYCLE_ACTIVE,
  LIFECYCLE_UNDER_REVIEW,
  LIFECYCLE_REFRESH_REQUIRED,
} from "@/lib/amips/tiers";
import { planClusterRepair, type RepairCandidate } from "@/lib/amips/lifecycle-repair";

const APPLY = process.argv.includes("--apply");

const SELECT = {
  id: true,
  slug: true,
  make: true,
  model: true,
  metro: true,
  lifecycleStatus: true,
  impressions: true,
  clicks: true,
  publishedAt: true,
} as const;

type Row = RepairCandidate & {
  make: string | null;
  model: string | null;
  metro: string | null;
};

function clusterKey(r: Row): string | null {
  if (!r.make || !r.model || !r.metro) return null;
  return `${r.make}|${r.model}|${r.metro}`.toLowerCase();
}

async function main(): Promise<void> {
  console.log(`\n=== amips-lifecycle-repair — ${APPLY ? "APPLY (writes)" : "DRY RUN (no writes)"} ===\n`);

  const demoted = (await prisma.amipsPage.findMany({
    where: {
      qualityGateStatus: "PUBLISHED",
      lifecycleStatus: { in: [LIFECYCLE_UNDER_REVIEW, LIFECYCLE_REFRESH_REQUIRED] },
    },
    select: SELECT,
  })) as Row[];

  console.log("--- BEFORE STATE (rollback record — no history table exists) ---");
  console.log(JSON.stringify(
    demoted.map((r) => ({ id: r.id, slug: r.slug, lifecycleStatus: r.lifecycleStatus })),
    null, 2,
  ));

  const refreshRequired = demoted.filter((r) => r.lifecycleStatus === LIFECYCLE_REFRESH_REQUIRED);
  const underReview = demoted.filter((r) => r.lifecycleStatus === LIFECYCLE_UNDER_REVIEW);

  console.log(`\n--- A. REFRESH_REQUIRED: ${refreshRequired.length} page(s) ---`);
  console.log("Servable again under FIX 3 with no data change. Not rewritten — promoting them");
  console.log("to ACTIVE would assert their data is fresh when it is not. Regenerate instead.\n");

  console.log(`--- B. UNDER_REVIEW (duplicate demotions): ${underReview.length} page(s) ---`);

  const clusters = new Map<string, Row[]>();
  for (const r of underReview) {
    const k = clusterKey(r);
    if (!k) {
      console.log(`  SKIP ${r.slug} — no make/model/metro; cannot have been a duplicate demotion`);
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
      select: SELECT,
    })) as Row[];

    const plan = planClusterRepair(siblings);

    if (plan.action === "skip") {
      leftAlone += members.length;
      const live = plan.liveCanonical ? ` (${plan.liveCanonical.slug})` : "";
      console.log(
        `  CLUSTER ${key}: ${plan.reason}${live}; leaving ${members.length} demoted sibling(s) as-is`,
      );
      continue;
    }

    console.log(
      `  CLUSTER ${key}: ${plan.reason}. ` +
      `PROMOTE ${plan.canonical.slug} (${plan.canonical.lifecycleStatus} -> ACTIVE); ` +
      `${siblings.length - 1} sibling(s) stay demoted`,
    );

    if (APPLY) {
      await prisma.amipsPage.update({
        where: { id: plan.canonical.id },
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
  if (promoted === 0) {
    console.log(`\n0 promotions is the EXPECTED and CORRECT result against the verified state:`);
    console.log(`every duplicate cluster already has a live canonical, so there is nothing to`);
    console.log(`repair. Promoting anything here would re-create the duplication.`);
  }
  if (!APPLY && promoted > 0) console.log(`\nDry run — nothing written. Re-run with --apply to write.`);
}

main()
  .catch((err) => {
    console.error("[amips-lifecycle-repair] failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
