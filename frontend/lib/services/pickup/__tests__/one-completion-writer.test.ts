// EXACTLY ONE MODULE WRITES A PICKUP TO COMPLETED — the scope hole in the other guard.
//
// WHY THIS EXISTS AS A SECOND FILE. `lib/__tests__/role-boundary-frozen.test.ts` counts the
// AutoLenis-ACTORED paths that can complete a pickup and scans `app/api/admin`. That is the right
// scan for the question it asks — §2 puts release on the dealership, and the risk it holds is a
// fourth admin ROUTE. It is the wrong scan for a different question with the same failure mode:
// a fifth WRITER, in a service, reachable from anywhere or from nowhere.
//
// AND THE DIFFERENCE WAS NOT THEORETICAL. `pickup.service.ts:completePickup` survived §8.2 defect
// (4)'s collapse of five Deal-completion writers into one. It had no callers, so nothing broke
// when it was left alone and a caller search found nothing — it read as harmless. Defect (8) then
// inserted HANDOVER_PENDING into the ladder, which made `PICKUP_SCHEDULED → COMPLETED` illegal, so
// its `advanceDealStatus` would refuse AFTER its `pickup.update` had committed: a pickup marked
// COMPLETED on a deal that is not. A function that used to work, broken by a change three files
// away, invisible to the guard built to prevent exactly this.
//
// It is retired by REFUSING rather than by deletion (CLAUDE.md: dead code is reported, never
// removed) and both facts are pinned below.
//
// Run: pnpm test:pickup

import test from "node:test";
import assert from "node:assert/strict";
import { sourceFiles, read, assertScanned } from "@/lib/testing/source-scan";

const ROOT = process.cwd();

/**
 * The ONE module allowed to write a Pickup to COMPLETED.
 *
 * A list of one, and it stays a list of one. Adding a second entry here is the reviewable diff
 * this guard exists to force — the collapse to a single writer is what makes §Stage 20's fourteen
 * preconditions a gate rather than a suggestion, and a second writer is a second set of
 * preconditions for the same irreversible act.
 */
const THE_COMPLETION_WRITER = "lib/services/pickup/pickup-completion.service.ts";

test("exactly one service module writes a Pickup to COMPLETED", () => {
  const files = sourceFiles(ROOT, ["lib/services", "lib/jobs"]);
  assertScanned(files, 200, "one-completion-writer scan");

  const writers = files.filter((f) => {
    const src = read(ROOT, f);
    // A WRITE, not a comparison. `pickup.status === "COMPLETED"` is a read and appears in several
    // services legitimately; `status: "COMPLETED"` inside a pickup write is the act.
    if (!/\bpickup\.(?:update|upsert|updateMany|create)\s*\(/.test(src)) return false;
    return /status:\s*(?:"COMPLETED"|'COMPLETED'|PickupStatus\.COMPLETED)/.test(src);
  });

  assert.deepEqual(
    writers,
    [THE_COMPLETION_WRITER],
    "§8.2 defect (4): five Deal-completion writers collapsed to one, so §Stage 20's fourteen " +
      "preconditions gate every completion. A second writer is a second set of preconditions for " +
      "an irreversible act — and the one that survived the first collapse went on to produce a " +
      "torn state when the ladder changed under it."
  );
});

test("the retired writer refuses rather than tearing the state, and is still present", async () => {
  // BOTH HALVES. That it refuses is the safety property; that it still EXISTS is the CLAUDE.md
  // property — dead code is reported for an owner decision, never deleted, and a test that only
  // checked the throw would pass just as well if somebody removed the export.
  const mod = await import("../pickup.service");
  assert.equal(typeof mod.completePickup, "function", "the symbol is retired, not removed");

  await assert.rejects(
    () => mod.completePickup("deal_1"),
    (err: Error) => {
      assert.match(err.message, /retired/i);
      assert.match(err.message, /pickup-completion\.service\.ts/, "the refusal must name the replacement");
      return true;
    },
    "a caller must get a sentence naming the replacement, not a corrupt deal"
  );
});

test("the guard detects a planted second writer — proved, not assumed", () => {
  // The same matcher the scan uses, against source that is not on disk. A guard whose detector is
  // never exercised is a guard that passes forever.
  const planted = `await prisma.pickup.update({ where: { dealId }, data: { status: "COMPLETED" } });`;
  const detects = (src: string) =>
    /\bpickup\.(?:update|upsert|updateMany|create)\s*\(/.test(src) &&
    /status:\s*(?:"COMPLETED"|'COMPLETED'|PickupStatus\.COMPLETED)/.test(src);

  assert.equal(detects(planted), true, "a direct write must be caught");
  assert.equal(
    detects(`if (pickup.status === "COMPLETED") return;`),
    false,
    "a READ of the status must not trip it, or the guard fires on every service that checks state"
  );
  assert.equal(
    detects(`await prisma.pickup.update({ where: { dealId }, data: { status: "RELEASED" } });`),
    false,
    "a write to another status is not a completion"
  );
});
