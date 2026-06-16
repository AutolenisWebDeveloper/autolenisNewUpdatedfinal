// Proof tests for the Layer-4 action scoring map + temperature derivation.
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/scoring-actions.proof.test.ts
//
// Invariants under proof:
//   1. The action→points map matches the spec table EXACTLY (a silent edit to a
//      point value is a scoring regression).
//   2. Temperature is derived from the cumulative score at the documented
//      hot≥85 / warm≥50 / cold thresholds.
//   3. The priority-outreach task fires ONLY on the first crossing into hot.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_POINTS,
  type ScoringAction,
  isScoringAction,
  pointsForAction,
  temperatureForScore,
  crossedHotThreshold,
  TEMP_HOT_MIN,
  TEMP_WARM_MIN,
} from '../scoring-actions';

// The spec's table, transcribed independently of the source module.
const SPEC: Record<ScoringAction, number> = {
  landing_page_visit: 1,
  article_read: 5,
  vehicle_search: 10,
  calculator_use: 20,
  zura_conversation: 25,
  vehicle_request: 100,
  offer_view: 50,
  offer_favorite: 75,
  offer_accepted: 200,
  deal_completed: 500,
};

test('action points match the spec table exactly', () => {
  assert.deepEqual(ACTION_POINTS, SPEC);
  for (const [action, points] of Object.entries(SPEC)) {
    assert.equal(pointsForAction(action as ScoringAction), points);
  }
});

test('isScoringAction accepts spec actions and rejects everything else', () => {
  for (const action of Object.keys(SPEC)) {
    assert.ok(isScoringAction(action));
  }
  assert.equal(isScoringAction('not_an_action'), false);
  assert.equal(isScoringAction(''), false);
  assert.equal(isScoringAction(undefined), false);
  assert.equal(isScoringAction(100), false);
});

test('temperature is derived at the documented thresholds', () => {
  assert.equal(temperatureForScore(0), 'cold');
  assert.equal(temperatureForScore(TEMP_WARM_MIN - 1), 'cold');
  assert.equal(temperatureForScore(TEMP_WARM_MIN), 'warm');
  assert.equal(temperatureForScore(TEMP_HOT_MIN - 1), 'warm');
  assert.equal(temperatureForScore(TEMP_HOT_MIN), 'hot');
  assert.equal(temperatureForScore(500), 'hot');
});

test('hot-threshold crossing fires only on the first transition into hot', () => {
  // below → at/above: fires.
  assert.equal(crossedHotThreshold(TEMP_HOT_MIN - 1, TEMP_HOT_MIN), true);
  assert.equal(crossedHotThreshold(0, 100), true);
  // already hot: does not re-fire.
  assert.equal(crossedHotThreshold(TEMP_HOT_MIN, TEMP_HOT_MIN + 50), false);
  assert.equal(crossedHotThreshold(200, 700), false);
  // stays below hot: does not fire.
  assert.equal(crossedHotThreshold(0, TEMP_HOT_MIN - 1), false);
});
