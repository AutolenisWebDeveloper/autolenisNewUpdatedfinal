// Regression coverage for a defect introduced BY FIX 3 and caught in this
// batch's independent second review.
//
// FIX 3 made REFRESH_REQUIRED servable. The duplicate-cluster builder still
// skipped every page whose lifecycleStatus !== "ACTIVE", so a live
// REFRESH_REQUIRED page no longer counted toward its own entity: an ACTIVE
// duplicate alongside it would have gone undetected, leaving two public pages
// competing for one (make, model, metro). Cluster membership must track
// SERVABILITY, not the ACTIVE literal.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isServableLifecycleStatus, SERVABLE_LIFECYCLE_STATUSES } from "@/lib/amips/tiers";

const SOURCE = readFileSync(join(process.cwd(), "lib/amips/lifecycle-manager.ts"), "utf8");

describe("duplicate clustering follows servability, not ACTIVE", () => {
  test("the cluster guard uses isServableLifecycleStatus", () => {
    assert.ok(
      /if \(!isServableLifecycleStatus\(p\.lifecycleStatus\)\) continue;/.test(SOURCE),
      "cluster membership must be keyed on servability",
    );
    assert.ok(
      !/if \(p\.lifecycleStatus !== "ACTIVE"\) continue;/.test(SOURCE),
      "the ACTIVE-literal cluster guard must be gone — it misses live REFRESH_REQUIRED pages",
    );
  });

  test("the page load covers every servable status plus UNDER_REVIEW", () => {
    // A page that is not loaded cannot cluster, so widening the guard without
    // widening the query would have been a no-op.
    assert.ok(
      /SERVABLE_LIFECYCLE_STATUSES, LIFECYCLE_UNDER_REVIEW/.test(SOURCE),
      "runLifecycleReview must load servable pages plus UNDER_REVIEW (for retirement)",
    );
  });

  test("every servable status is a candidate for clustering", () => {
    for (const status of SERVABLE_LIFECYCLE_STATUSES) {
      assert.ok(isServableLifecycleStatus(status), status);
    }
    assert.ok(isServableLifecycleStatus("REFRESH_REQUIRED"));
  });

  test("withheld statuses never cluster", () => {
    // UNDER_REVIEW pages are loaded for the retirement branch but must not
    // occupy an entity — they are not public.
    assert.equal(isServableLifecycleStatus("UNDER_REVIEW"), false);
    assert.equal(isServableLifecycleStatus("RETIRED"), false);
  });

  test("only ACTIVE pages are demoted (non-ACTIVE servable pages fall through)", () => {
    // Widening the load must not create new write paths.
    const writes = [...SOURCE.matchAll(/data:\s*\{\s*lifecycleStatus:\s*"([A-Z_]+)"\s*\}/g)];
    assert.equal(writes.length, 3, "no new lifecycleStatus write sites may appear");
  });
});
