// BLOCKER 1 — the repair script would have re-created all 31 duplicates.
//
// Owner-verified production, across the 31 UNDER_REVIEW+PUBLISHED clusters:
//   clusters with an ACTIVE sibling            0
//   clusters with a REFRESH_REQUIRED sibling  31
//   fully dark clusters                        0
//
// Pre-fix the script asked `lifecycleStatus === "ACTIVE"`. Since FIX 3 made
// REFRESH_REQUIRED servable, that question no longer matches reality: those 31
// clusters each already have a LIVE canonical, so promoting a demoted sibling
// would put two live pages on one make+model+metro.
//
// This is the same ACTIVE-literal-vs-servability assumption the second review
// caught in the clustering path; the script carried a second copy.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planClusterRepair, rankCanonical, type RepairCandidate } from "@/lib/amips/lifecycle-repair";

const page = (
  slug: string,
  lifecycleStatus: string,
  publishedAt: string | null = "2026-06-25",
  impressions = 0,
  clicks = 0,
): RepairCandidate => ({
  id: `id-${slug}`,
  slug,
  lifecycleStatus,
  impressions,
  clicks,
  publishedAt: publishedAt ? new Date(publishedAt) : null,
});

describe("BLOCKER 1 — a REFRESH_REQUIRED canonical yields zero promotions", () => {
  test("the verified production shape: canonical REFRESH_REQUIRED, demoted UNDER_REVIEW", () => {
    // THE pin. Fails against the pre-fix rule, which promoted the UNDER_REVIEW page.
    const plan = planClusterRepair([
      page("ford-f-150-dallas-fort-worth", "REFRESH_REQUIRED", "2026-06-25"),
      page("best-price-ford-f-150-dallas", "UNDER_REVIEW", "2026-06-26"),
    ]);
    assert.equal(plan.action, "skip");
    assert.match(plan.reason, /already live/);
    assert.equal(
      plan.action === "skip" ? plan.liveCanonical?.slug : null,
      "ford-f-150-dallas-fort-worth",
    );
  });

  test("all 31 verified clusters resolve to skip", () => {
    // Every cluster in production has exactly this shape.
    for (let i = 0; i < 31; i++) {
      const plan = planClusterRepair([
        page(`canonical-${i}`, "REFRESH_REQUIRED", "2026-06-25"),
        page(`demoted-${i}`, "UNDER_REVIEW", "2026-06-26"),
      ]);
      assert.equal(plan.action, "skip", `cluster ${i} must not promote`);
    }
  });

  test("an ACTIVE canonical also yields skip", () => {
    const plan = planClusterRepair([
      page("canonical", "ACTIVE"),
      page("demoted", "UNDER_REVIEW"),
    ]);
    assert.equal(plan.action, "skip");
    assert.match(plan.reason, /ACTIVE/);
  });

  test("a fully dark cluster DOES promote exactly one", () => {
    // The case the script exists for. Nothing servable, so one page comes back.
    const plan = planClusterRepair([
      page("older", "UNDER_REVIEW", "2026-06-25"),
      page("newer", "UNDER_REVIEW", "2026-06-26"),
      page("newest", "RETIRED", "2026-06-27"),
    ]);
    assert.equal(plan.action, "promote");
    assert.equal(plan.action === "promote" ? plan.canonical.slug : null, "older");
  });

  test("promotion picks exactly one canonical, never several", () => {
    const plan = planClusterRepair([
      page("a", "UNDER_REVIEW", "2026-06-25"),
      page("b", "UNDER_REVIEW", "2026-06-26"),
      page("c", "UNDER_REVIEW", "2026-06-27"),
    ]);
    assert.equal(plan.action, "promote");
    // A single canonical field — the shape makes multiple promotions impossible.
    assert.ok(plan.action === "promote" && typeof plan.canonical.slug === "string");
  });

  test("re-running after a promotion is a no-op (idempotent)", () => {
    // The promoted page is ACTIVE, hence servable, hence the cluster skips.
    const after = planClusterRepair([
      page("older", "ACTIVE", "2026-06-25"),
      page("newer", "UNDER_REVIEW", "2026-06-26"),
    ]);
    assert.equal(after.action, "skip");
  });

  test("an empty cluster is skipped, not crashed", () => {
    const plan = planClusterRepair([]);
    assert.equal(plan.action, "skip");
    assert.equal(plan.action === "skip" ? plan.liveCanonical : undefined, null);
  });
});

describe("canonical ranking", () => {
  test("impressions win first", () => {
    const sorted = [page("low", "UNDER_REVIEW", "2026-06-01", 5), page("high", "UNDER_REVIEW", "2026-06-30", 500)]
      .sort(rankCanonical);
    assert.equal(sorted[0].slug, "high");
  });

  test("clicks break an impressions tie", () => {
    const sorted = [page("a", "UNDER_REVIEW", "2026-06-01", 10, 1), page("b", "UNDER_REVIEW", "2026-06-30", 10, 9)]
      .sort(rankCanonical);
    assert.equal(sorted[0].slug, "b");
  });

  test("with all-zero traffic it falls through to earliest publishedAt", () => {
    // Production: impressions and clicks are zero corpus-wide, so this is the
    // operative branch and it matches the order the lifecycle manager used.
    const sorted = [page("newer", "UNDER_REVIEW", "2026-06-26"), page("older", "UNDER_REVIEW", "2026-06-25")]
      .sort(rankCanonical);
    assert.equal(sorted[0].slug, "older");
  });

  test("an unpublished page never outranks a published one", () => {
    const sorted = [page("unpublished", "UNDER_REVIEW", null), page("published", "UNDER_REVIEW", "2026-06-26")]
      .sort(rankCanonical);
    assert.equal(sorted[0].slug, "published");
  });
});
