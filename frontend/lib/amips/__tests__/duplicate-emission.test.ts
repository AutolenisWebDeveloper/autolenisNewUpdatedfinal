// Regression coverage for FIX 1 — duplicate page emission, the root cause of the
// 31 pages found demoted to UNDER_REVIEW in production.
//
// Two independent defects, one per describe block below:
//
//   1a  buildQueueDrafts() emitted 45 drafts sharing an identical keywordTarget.
//       VEHICLE_SEEDS carries one row per TRIM, and neither the Tier B nor the
//       Tier C keyword template includes the trim, so Ford F-150 XL and XLT
//       collapsed to the same keyword. seedContentQueue() filters against
//       keywords ALREADY IN THE DATABASE but never against the batch it is
//       inserting, and content_queue has no unique constraint on
//       keyword_target — so createMany inserted both.
//
//   1b  The generator had no ENTITY-uniqueness check. Its only duplicate
//       defences were the `slug` unique constraint (identical keyword) and
//       Quality Gate 2 (body-text Jaccard similarity). Two queue items for the
//       same vehicle+metro under different keyword phrasings therefore produced
//       two different slugs, and Gate 2 passed them both whenever the generated
//       prose differed by more than 20%.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildQueueDrafts } from "@/lib/amips/seed/content-queue.seed";
import { VEHICLE_SEEDS } from "@/lib/amips/seed/vehicle-intelligence.seed";
import { findEntityConflict } from "@/lib/amips/amips-generator";

describe("1a — queue drafts carry no duplicate keyword targets", () => {
  test("the seed list still contains a make+model with multiple trims", () => {
    // Guards the premise. If this ever becomes false the dedup below is still
    // correct, but the specific production trigger has gone away and this test
    // should be re-read rather than silently passing for the wrong reason.
    const mm = VEHICLE_SEEDS.map((v) => `${v.make}|${v.model}`);
    assert.ok(
      new Set(mm).size < mm.length,
      "expected at least one make+model with more than one trim row",
    );
  });

  test("buildQueueDrafts emits each keywordTarget exactly once", () => {
    // FAILS against pre-fix code: 45 duplicate keywordTargets (20 Tier B angles
    // + 25 Tier C metros, all from the single duplicated make+model).
    const drafts = buildQueueDrafts();
    const keys = drafts.map((d) => d.keywordTarget);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    assert.deepEqual(dupes, [], `duplicate keywordTargets: ${dupes.slice(0, 5).join(", ")}`);
  });

  test("no (make, model, metro) triple maps to more than one slug", () => {
    // The condition the lifecycle manager's duplicate cluster keys on.
    const slugify = (s: string) =>
      s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const byTriple = new Map<string, Set<string>>();
    for (const d of buildQueueDrafts()) {
      if (!d.make || !d.model || !d.metro) continue;
      const k = `${d.make}|${d.model}|${d.metro}`.toLowerCase();
      const set = byTriple.get(k) ?? new Set<string>();
      set.add(slugify(d.keywordTarget));
      byTriple.set(k, set);
    }
    const multi = [...byTriple.entries()].filter(([, s]) => s.size > 1);
    assert.deepEqual(multi.map(([k]) => k), []);
  });

  test("deduping preserves the highest-priority draft", () => {
    const drafts = buildQueueDrafts();
    for (let i = 1; i < drafts.length; i++) {
      assert.ok(
        drafts[i - 1].priorityScore >= drafts[i].priorityScore,
        "drafts must remain sorted by descending priority after dedup",
      );
    }
  });
});

describe("1b — the generator refuses a second page for one entity", () => {
  const page = (slug: string, lifecycleStatus = "ACTIVE") => ({ slug, lifecycleStatus });

  test("flags an existing page covering the same vehicle+metro", () => {
    // The exact production shape: same triple, different keyword phrasing.
    const conflict = findEntityConflict(
      [page("ford-f-150-deals-in-dallas-fort-worth")],
      { slug: "best-price-ford-f-150-dallas-fort-worth", metro: "Dallas-Fort Worth" },
    );
    assert.equal(conflict?.slug, "ford-f-150-deals-in-dallas-fort-worth");
  });

  test("does not flag a page against itself (regeneration must still work)", () => {
    const conflict = findEntityConflict(
      [page("ford-f-150-deals-in-dallas-fort-worth")],
      { slug: "ford-f-150-deals-in-dallas-fort-worth", metro: "Dallas-Fort Worth" },
    );
    assert.equal(conflict, null);
  });

  test("never flags a page with no metro (Tier A/B share make+model by design)", () => {
    // Tier B generates 20 angles for one vehicle; all have metro null and are
    // skipped by the lifecycle cluster key, so they must not conflict here.
    for (const metro of [null, undefined, ""]) {
      assert.equal(
        findEntityConflict([page("2025-ford-f-150-lease-deals")], {
          slug: "2025-ford-f-150-incentives",
          metro,
        }),
        null,
        `metro=${String(metro)}`,
      );
    }
  });

  test("returns null when no other page covers the entity", () => {
    assert.equal(findEntityConflict([], { slug: "a", metro: "Austin" }), null);
  });

  test("conflicts with a non-ACTIVE page too", () => {
    // A demoted sibling still occupies the entity. Emitting another page would
    // recreate the cluster the lifecycle manager just resolved.
    const conflict = findEntityConflict([page("older-page", "UNDER_REVIEW")], {
      slug: "newer-page",
      metro: "Austin",
    });
    assert.equal(conflict?.slug, "older-page");
    assert.equal(conflict?.lifecycleStatus, "UNDER_REVIEW");
  });
});

describe("1b — the guard runs before the model call", () => {
  // Refusing a page only after generating it pays for output we discard, and on
  // a queue item that retries (attempts increments) it pays repeatedly.
  const SOURCE = readFileSync(
    join(process.cwd(), "lib/amips/amips-generator.ts"),
    "utf8",
  );

  test("findEntityConflict is checked before groqChat", () => {
    const guard = SOURCE.indexOf("findEntityConflict(existing");
    const llm = SOURCE.indexOf("groqChat(");
    assert.ok(guard > 0 && llm > 0, "expected both call sites to exist");
    assert.ok(guard < llm, "entity guard must precede the model call");
  });

  test("the same-entity query serves both the guard and Gate 2", () => {
    // One round trip, two uses. Duplicating it would drift.
    const queries = [...SOURCE.matchAll(/prisma\.amipsPage\.findMany\(/g)];
    assert.equal(queries.length, 1, "expected exactly one same-entity query");
    assert.ok(/existing\.map\(\(e\) => e\.body\)/.test(SOURCE), "Gate 2 must reuse it");
  });
});
