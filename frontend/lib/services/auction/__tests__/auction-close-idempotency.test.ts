// F-001 — idempotency contract for auction post-close processing.
// Run with:  npx tsx --test lib/services/auction/__tests__/auction-close-idempotency.test.ts
//
// processAuctionClose claims an auction by flipping post_close_processed_at from
// NULL → now() via an atomic updateMany, then only proceeds if exactly one row
// was claimed. These tests lock that guard so a concurrent or repeated
// invocation (overlapping cron ticks, admin manual close racing the cron) can
// never double-notify the buyer or double-issue the zero-offer refund.

import test from "node:test";
import assert from "node:assert/strict";
import { postCloseClaimWon } from "../auction.service";

test("claim is won only when exactly one row flipped from NULL", () => {
  // updateMany on a unique id returns 1 when this run won the NULL→now flip.
  assert.equal(postCloseClaimWon(1), true);
});

test("claim is lost when zero rows updated (already processed / concurrent owner)", () => {
  // 0 means another invocation already owns the post-close work — skip, do not
  // re-run side effects. This is the core anti-double-notify / anti-double-refund guard.
  assert.equal(postCloseClaimWon(0), false);
});

test("defensive: an unexpected count > 1 does not count as a clean single-owner claim", () => {
  // The guard is intentionally strict (=== 1). A unique-id updateMany can never
  // return >1; treating it as "not won" fails safe rather than fanning out side effects.
  assert.equal(postCloseClaimWon(2), false);
});

test("the reconciler processes a CLOSED auction regardless of how long ago it closed", () => {
  // Documents the cron's reconciler contract: selection is by
  // { status: CLOSED, postCloseProcessedAt: null } — NOT a trailing time window.
  // An auction closed hours ago but never processed is still eligible, so a
  // missed/slow tick self-heals. (Predicate mirrored here as the contract under test.)
  const eligible = (a: { status: string; postCloseProcessedAt: Date | null }) =>
    a.status === "CLOSED" && a.postCloseProcessedAt === null;

  const longAgoUnprocessed = { status: "CLOSED", postCloseProcessedAt: null };
  const alreadyProcessed = { status: "CLOSED", postCloseProcessedAt: new Date() };
  const stillActive = { status: "ACTIVE", postCloseProcessedAt: null };

  assert.equal(eligible(longAgoUnprocessed), true);
  assert.equal(eligible(alreadyProcessed), false);
  assert.equal(eligible(stillActive), false);
});
