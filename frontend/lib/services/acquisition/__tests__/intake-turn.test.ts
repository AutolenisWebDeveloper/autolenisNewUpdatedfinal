// A′ — pure decision for what a concierge chat turn should trigger. The
// race-sensitive rule (never enqueue the durable pipeline twice in one turn)
// lives here so it is unit-proven independent of the streaming route.
//
//   npx tsx --test lib/services/acquisition/__tests__/intake-turn.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { decideIntakeTurnActions } from "../intake-turn";

test("completion promotes and does NOT separately enqueue (promote already enqueues)", () => {
  // allCaptured for the first time, phone completed the request this same turn.
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: false, phoneJustCaptured: true });
  assert.equal(a.promote, true);
  // Critical: no second enqueue this turn — two concurrent intake.process events
  // would both clear the pipeline guards and double-notify the founder.
  assert.equal(a.enqueuePipeline, false);
  assert.equal(a.crmCapture, true);
});

test("completion without a fresh phone still promotes, no separate enqueue", () => {
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: false, phoneJustCaptured: false });
  assert.equal(a.promote, true);
  assert.equal(a.enqueuePipeline, false);
  assert.equal(a.crmCapture, false);
});

test("contactable-but-incomplete lead enqueues the pipeline for scoring/alerts (retired inline)", () => {
  const a = decideIntakeTurnActions({ allCaptured: false, alreadyCompleted: false, phoneJustCaptured: true });
  assert.equal(a.promote, false);
  assert.equal(a.enqueuePipeline, true); // preserves the immediate hot-lead alert
  assert.equal(a.crmCapture, true);
});

test("already-completed opportunity never re-promotes", () => {
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: true, phoneJustCaptured: false });
  assert.equal(a.promote, false);
  assert.equal(a.enqueuePipeline, false);
  assert.equal(a.crmCapture, false);
});

test("nothing actionable this turn → no side effects", () => {
  const a = decideIntakeTurnActions({ allCaptured: false, alreadyCompleted: false, phoneJustCaptured: false });
  assert.deepEqual(a, { promote: false, enqueuePipeline: false, crmCapture: false });
});
