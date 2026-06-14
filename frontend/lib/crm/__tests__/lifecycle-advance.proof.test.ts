// Proof tests for the spine lifecycle-stage advance policy.
// Run with:
//   npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json --test \
//     lib/crm/__tests__/lifecycle-advance.proof.test.ts
//
// Focus: the event→stage map is forward-only. A funnel event advances the
// stage; a later, earlier-stage event NEVER downgrades it (mirrors the
// lead-score never-downgrade rule). stage_changed is signalled (non-null
// return) ONLY on a real advance.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStageAdvance,
  EVENT_TO_STAGE,
  STAGE_RANK,
} from '../../events/lifecycle-advance';

test('purchase_completed advances a fresh lead all the way to purchase_completed', () => {
  assert.equal(resolveStageAdvance('lead', 'purchase_completed'), 'purchase_completed');
});

test('never-downgrade: a later vehicle_request_submitted does NOT pull purchase_completed back', () => {
  // Contact is already purchased. A late top-of-funnel event must be a no-op.
  assert.equal(resolveStageAdvance('purchase_completed', 'vehicle_request_submitted'), null);
  // And an equal-stage event is also a no-op (no spurious stage_changed row).
  assert.equal(resolveStageAdvance('purchase_completed', 'purchase_completed'), null);
});

test('forward steps return the new stage (drives the stage_changed timeline write)', () => {
  assert.equal(resolveStageAdvance('lead', 'prequal_started'), 'prequal_started');
  assert.equal(resolveStageAdvance('prequal_started', 'deposit_paid'), 'deposit_paid');
  assert.equal(resolveStageAdvance('deposit_paid', 'auction_started'), 'auction_active');
  assert.equal(resolveStageAdvance('auction_active', 'offer_received'), 'offer_received');
});

test('same-stage and backward events return null (no stage_changed row)', () => {
  assert.equal(resolveStageAdvance('deposit_paid', 'deposit_paid'), null);
  assert.equal(resolveStageAdvance('offer_received', 'deposit_pending'), null);
  // Top-of-funnel lead-capture events never advance an existing contact.
  assert.equal(resolveStageAdvance('prequal_started', 'lead_magnet_downloaded'), null);
});

test('buyer_inactive is the explicit exception: sets inactive from any active stage, idempotent', () => {
  assert.equal(resolveStageAdvance('lead', 'buyer_inactive'), 'inactive');
  assert.equal(resolveStageAdvance('purchase_completed', 'buyer_inactive'), 'inactive');
  // Already inactive → no repeat stage_changed row.
  assert.equal(resolveStageAdvance('inactive', 'buyer_inactive'), null);
});

test('every event maps to a stage and every stage is ranked (exhaustive, no drift)', () => {
  for (const [event, stage] of Object.entries(EVENT_TO_STAGE)) {
    assert.ok(stage in STAGE_RANK, `event ${event} maps to unranked stage ${stage}`);
  }
});
