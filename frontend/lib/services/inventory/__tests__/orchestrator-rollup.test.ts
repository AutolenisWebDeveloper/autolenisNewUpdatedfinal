// Batch 1 — run-level outcome roll-up (deterministic verification of PARTIAL).
// The live orchestrator ships a single adapter, so a mixed SUCCESS/FAILED run
// cannot occur there today; this pins the rule so it stays correct when a second
// source is added.
//
//   npx tsx --test lib/services/inventory/__tests__/orchestrator-rollup.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { rollUpOutcome } from "@/lib/services/inventory/orchestrator";

test("mixed SUCCESS + FAILED → PARTIAL (never a clean SUCCESS hiding a failure)", () => {
  assert.equal(rollUpOutcome(["SUCCESS", "FAILED"]), "PARTIAL");
});

test("mixed SUCCESS + DEFERRED → PARTIAL", () => {
  assert.equal(rollUpOutcome(["SUCCESS", "DEFERRED"]), "PARTIAL");
});

test("all SUCCESS → SUCCESS", () => {
  assert.equal(rollUpOutcome(["SUCCESS", "SUCCESS"]), "SUCCESS");
});

test("SUCCESS + NOT_CONFIGURED (unconfigured is skipped, not a failure) → SUCCESS", () => {
  assert.equal(rollUpOutcome(["SUCCESS", "NOT_CONFIGURED"]), "SUCCESS");
});

test("only ZERO_RESULTS → ZERO_RESULTS", () => {
  assert.equal(rollUpOutcome(["ZERO_RESULTS"]), "ZERO_RESULTS");
});

test("only FAILED → FAILED", () => {
  assert.equal(rollUpOutcome(["FAILED"]), "FAILED");
});

test("only DEFERRED → DEFERRED", () => {
  assert.equal(rollUpOutcome(["DEFERRED"]), "DEFERRED");
});

test("all NOT_CONFIGURED → NOT_CONFIGURED (never SUCCESS)", () => {
  assert.equal(rollUpOutcome(["NOT_CONFIGURED", "NOT_CONFIGURED"]), "NOT_CONFIGURED");
});

test("FAILED + ZERO_RESULTS (no success) → FAILED, not PARTIAL", () => {
  assert.equal(rollUpOutcome(["FAILED", "ZERO_RESULTS"]), "FAILED");
});

// ── PARTIAL and BUDGET_EXHAUSTED ─────────────────────────────────────────────
//
// These are plain `.some()` string comparisons, NOT a compile-checked switch, so adding a
// member to AdapterOutcome does not fail the build here — it falls silently through every
// branch and lands on NOT_CONFIGURED. That is exactly what had happened to PARTIAL: the
// enum member existed and a run that ingested 150 vehicles reported itself as an
// unconfigured provider. Every member of the union is pinned below.

test("a PARTIAL adapter makes the whole run PARTIAL, not NOT_CONFIGURED", () => {
  assert.equal(rollUpOutcome(["PARTIAL"]), "PARTIAL");
  assert.equal(rollUpOutcome(["SUCCESS", "PARTIAL"]), "PARTIAL");
  assert.equal(rollUpOutcome(["PARTIAL", "ZERO_RESULTS"]), "PARTIAL");
});

test("a deliberate spend-stop is reported as itself, never as an empty market", () => {
  assert.equal(rollUpOutcome(["BUDGET_EXHAUSTED"]), "BUDGET_EXHAUSTED");
  assert.equal(rollUpOutcome(["BUDGET_EXHAUSTED", "ZERO_RESULTS"]), "BUDGET_EXHAUSTED",
    '"we did not ask" and "we asked and it was empty" are different facts');
  assert.equal(rollUpOutcome(["SUCCESS", "BUDGET_EXHAUSTED"]), "SUCCESS",
    "one source stopping on budget does not spoil another source's real success");
});

test("every AdapterOutcome member maps to something other than the NOT_CONFIGURED fallthrough", () => {
  const members = ["SUCCESS", "ZERO_RESULTS", "NOT_CONFIGURED", "DEFERRED", "FAILED",
    "PARTIAL", "BUDGET_EXHAUSTED"] as const;
  for (const m of members) {
    const got = rollUpOutcome([m]);
    if (m === "NOT_CONFIGURED") assert.equal(got, "NOT_CONFIGURED");
    else assert.notEqual(got, "NOT_CONFIGURED", `${m} must not fall through to NOT_CONFIGURED`);
  }
});
