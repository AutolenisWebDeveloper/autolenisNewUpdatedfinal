// §11.6 rulings 4–5 / PAY-94 — "Phase 3 provides only the ledger SHAPE."
//
// The commission ledger's TIMING moves in Phase 9 (creation and settlement at Deal
// COMPLETED, not at fee `payment_intent.succeeded`), and its reversal hook is read by
// Phase 10's cancellation orchestration. What Phase 3 owes is the shape those two phases
// will build on — and what a shape assertion is worth is that it fails when someone
// changes it without meaning to.
//
// Nothing here is new code. This file exists BECAUSE nothing here is new code: the shape
// is already correct, and "already correct" is a claim that needs a test rather than a
// paragraph. Without it, "Phase 3 provides the ledger shape" is a sentence in a document
// with nothing holding it up.
//
// The four properties Phases 9 and 10 depend on:
//
//   1. REVERSED exists as a status, distinct from REJECTED. A reversed commission is one
//      that was legitimately earned and then unearned; a rejected one never qualified.
//      Collapsing them would make a clawback indistinguishable from a refusal.
//   2. `qualifying_event_id` is UNIQUE, and the per-level key is `${event}-L${level}`.
//      That is what makes the walk re-entrant and what lets a reversal find every level
//      of one tree by prefix — the mechanism Phase 10 will call.
//   3. PAID is never auto-reversed. Money already out of the door needs a human, and the
//      reversal primitive returns those ids for manual clawback rather than flipping
//      them.
//   4. `reversed_at` is stamped, so "when" survives.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "lib/services/affiliate/__tests__/commission-ledger-shape.test.ts"

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");

function block(name: string): string {
  const start = SCHEMA.indexOf(name);
  assert.ok(start >= 0, `${name} not found in schema.prisma`);
  const end = SCHEMA.indexOf("\n}", start);
  return SCHEMA.slice(start, end);
}

test("CommissionStatus carries REVERSED, and it is not REJECTED", () => {
  const e = block("enum CommissionStatus {");
  for (const label of ["PENDING", "APPROVED", "PAID", "REVERSED", "REJECTED"]) {
    assert.match(e, new RegExp(`\\b${label}\\b`), `${label} must exist`);
  }
  // A reversed commission was earned and then unearned; a rejected one never qualified.
  // Phase 10 reverses; nothing auto-rejects.
  assert.notEqual("REVERSED", "REJECTED");
});

test("the reversal facts are on the row: status, reversedAt", () => {
  const m = block("model Commission {");
  assert.match(m, /status\s+CommissionStatus/);
  assert.match(m, /reversedAt\s+DateTime\?\s+@map\("reversed_at"\)/);
});

test("qualifyingEventId is UNIQUE — the whole idempotency story rests on it", () => {
  const m = block("model Commission {");
  assert.match(
    m,
    /qualifyingEventId\s+String\s+@unique/,
    "without the unique index the walk is not re-entrant and a redelivered webhook doubles the ledger",
  );
});

test("the basis is stored, so an amount can be re-derived rather than trusted", () => {
  const m = block("model Commission {");
  assert.match(m, /basisCents\s+Int\?/);
  assert.match(m, /amountCents\s+Int/);
  assert.match(m, /level\s+Int/);
  assert.match(m, /rate\s+Float/);
});

test("the reversal primitive exists, is prefix-keyed, and never auto-reverses PAID", async () => {
  const src = readFileSync(
    join(process.cwd(), "lib", "services", "affiliate", "commission.service.ts"),
    "utf8",
  );
  const fn = src.slice(src.indexOf("export async function reverseCommissionsForPaymentIntent"));

  assert.match(fn, /-L`/, "the key prefix is `${piId}-L`, which is what finds every level of one tree");
  assert.match(
    fn,
    /status:\s*\{\s*in:\s*\[\s*"PENDING",\s*"APPROVED"\s*\]/,
    "the update is STATUS-GUARDED to PENDING and APPROVED — PAID and REJECTED are unreachable by it",
  );
  assert.match(
    fn,
    /paidNeedingReview/,
    "and PAID rows are RETURNED for a human clawback rather than flipped: money already out of the door needs a person",
  );
});

// The two gaps, recorded rather than fixed. Both need a migration, and Phase 3 ships
// exactly one (the DepositStatus.DISPUTED label). Naming them here means Phase 9 and
// Phase 10 inherit a known shape rather than discovering it.
test("KNOWN GAPS: no reversedBy, and no dealId relation", () => {
  const m = block("model Commission {");
  assert.ok(
    !/reversedBy/.test(m),
    "`approvedBy` records who approved; there is no `reversedBy` to record who reversed. " +
      "A clawback is at least as consequential as an approval, and today it is anonymous.",
  );
  assert.ok(
    /dealId\s+String/.test(m) && !/deal\s+Deal\s+@relation/.test(m),
    "`deal_id` is a bare column with no declared relation, so a commission cannot be joined " +
      "to its deal in Prisma — every consumer crosses that join by hand.",
  );
});
