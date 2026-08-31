#!/usr/bin/env tsx
/**
 * Backfill dealer_rooftops.latitude/longitude. OWNER-RUN, NOT A CRON.
 *
 * dealer_rooftops has 0/1,389 coordinates. Prospects are meant to read geo
 * THROUGH their rooftop rather than keeping a private copy, so the rooftop is
 * the row that needs them. The existing geocode-backfill cron fills Dealer and
 * DealerProspect coordinates and is deliberately untouched.
 *
 * Two sources, strongest first, and they are NOT equivalent:
 *   dealer_intelligence  a real observed location, matched on name+city+state
 *   zip centroid         the middle of a postal area, not the store
 * The source is printed per row and recorded on write, because "roughly how far"
 * and "where is it" are different questions.
 *
 * DEFAULT IS DRY RUN. Writing requires BOTH:
 *   --apply                     on the command line
 *   GEO_BACKFILL_CONFIRM=yes    in the environment
 *
 * Two independent confirmations because a single flag is too easy to paste from
 * a runbook into a production shell without reading it. Without both, the plan
 * is printed and nothing is written.
 *
 *   pnpm exec tsx scripts/backfill-rooftop-geo.ts
 *   GEO_BACKFILL_CONFIRM=yes pnpm exec tsx scripts/backfill-rooftop-geo.ts --apply
 */

import {
  planRooftopGeoBackfill,
  applyRooftopGeoBackfill,
} from "../lib/services/dealer-recruitment/rooftop-geo-backfill.service";

async function main(): Promise<void> {
  const applyRequested = process.argv.includes("--apply");
  const confirmed = process.env.GEO_BACKFILL_CONFIRM === "yes";

  console.log("Planning rooftop geo backfill (reads only)...\n");
  const plan = await planRooftopGeoBackfill();

  const c = plan.counts;
  console.log("  rooftops scanned          ", c.scanned);
  console.log("  already have coordinates  ", c.alreadyHasCoords);
  console.log("  from dealer_intelligence  ", c.fromIntelligence, "(real observed location)");
  console.log("  from zip centroid         ", c.fromZipCentroid, "(postal-area midpoint, NOT the store)");
  console.log("  unresolved                ", c.unresolved);
  console.log("  ---------------------------");
  console.log("  would write               ", plan.entries.length, "\n");

  if (plan.unresolvedIds.length > 0) {
    // Named rather than summarised: an unresolved rooftop is a gap someone can
    // go and fix, and a bare count gives them nothing to act on.
    const shown = plan.unresolvedIds.slice(0, 20);
    console.log(`  unresolved rooftop ids (${shown.length} of ${plan.unresolvedIds.length}):`);
    for (const id of shown) console.log("    ", id);
    console.log("");
  }

  if (!applyRequested) {
    console.log("DRY RUN — nothing written. Re-run with --apply and GEO_BACKFILL_CONFIRM=yes to write.");
    return;
  }
  if (!confirmed) {
    console.error("--apply was passed but GEO_BACKFILL_CONFIRM=yes was not set. Nothing written.");
    process.exitCode = 1;
    return;
  }

  console.log(`Applying ${plan.entries.length} coordinate write(s)...\n`);
  const result = await applyRooftopGeoBackfill(plan);
  console.log("  written", result.written);
  console.log("  failed ", result.failed);
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("rooftop geo backfill failed:", err);
  process.exitCode = 1;
});
