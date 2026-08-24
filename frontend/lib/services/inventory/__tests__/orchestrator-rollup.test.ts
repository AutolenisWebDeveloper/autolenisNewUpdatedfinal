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
