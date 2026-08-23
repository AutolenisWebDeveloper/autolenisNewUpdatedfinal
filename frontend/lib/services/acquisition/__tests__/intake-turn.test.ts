// A′ — pure decision for what a concierge chat turn should trigger. Buyer intake
// is Inngest-free (the cron runs orchestration off the persisted row), so a turn
// only decides `promote` (create the VehicleRequest) and `crmCapture`.
//
//   npx tsx --test lib/services/acquisition/__tests__/intake-turn.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { decideIntakeTurnActions } from "../intake-turn";

test("completion promotes and captures CRM", () => {
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: false, phoneJustCaptured: true });
  assert.equal(a.promote, true);
  assert.equal(a.crmCapture, true);
});

test("completion without a fresh phone still promotes, no CRM capture", () => {
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: false, phoneJustCaptured: false });
  assert.equal(a.promote, true);
  assert.equal(a.crmCapture, false);
});

test("contactable-but-incomplete lead captures CRM but does not promote", () => {
  const a = decideIntakeTurnActions({ allCaptured: false, alreadyCompleted: false, phoneJustCaptured: true });
  assert.equal(a.promote, false);
  assert.equal(a.crmCapture, true);
});

test("already-completed opportunity never re-promotes", () => {
  const a = decideIntakeTurnActions({ allCaptured: true, alreadyCompleted: true, phoneJustCaptured: false });
  assert.equal(a.promote, false);
  assert.equal(a.crmCapture, false);
});

test("nothing actionable this turn → no side effects", () => {
  const a = decideIntakeTurnActions({ allCaptured: false, alreadyCompleted: false, phoneJustCaptured: false });
  assert.deepEqual(a, { promote: false, crmCapture: false });
});
