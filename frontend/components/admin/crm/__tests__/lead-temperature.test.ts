// Unit tests for the null-safe Leads lead_score sort + temperature resolver.
// Run with:  npx tsx --test components/admin/crm/__tests__/lead-temperature.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveTemperature,
  leadScoreSortValue,
  temperatureForStage,
} from '../lead-temperature';

test('resolveTemperature uses the REAL lead_temperature when present', () => {
  assert.equal(resolveTemperature({ lead_temperature: 'hot', lifecycle_stage: 'lead' }), 'hot');
  assert.equal(resolveTemperature({ lead_temperature: 'warm', lifecycle_stage: 'lead' }), 'warm');
  assert.equal(resolveTemperature({ lead_temperature: 'cold', lifecycle_stage: 'offer_received' }), 'cold');
});

test('resolveTemperature falls back to lifecycle stage when lead_temperature is null/undefined (migration 06 not applied)', () => {
  // null
  assert.equal(resolveTemperature({ lead_temperature: null, lifecycle_stage: 'deposit_paid' }), 'hot');
  // undefined (column absent entirely)
  assert.equal(resolveTemperature({ lifecycle_stage: 'prequal_started' }), 'warm');
  assert.equal(resolveTemperature({ lifecycle_stage: 'lead' }), 'cold');
  // unknown / malformed value also falls back
  assert.equal(resolveTemperature({ lead_temperature: 'lukewarm', lifecycle_stage: 'lead' }), 'cold');
  // sanity: matches the standalone stage helper
  assert.equal(
    resolveTemperature({ lifecycle_stage: 'offer_received' }),
    temperatureForStage('offer_received'),
  );
});

test('leadScoreSortValue ranks a null/undefined score as the lowest value', () => {
  assert.equal(leadScoreSortValue({ lead_score: 87 }), 87);
  assert.equal(leadScoreSortValue({ lead_score: 0 }), 0);
  assert.equal(leadScoreSortValue({ lead_score: null }), Number.NEGATIVE_INFINITY);
  assert.equal(leadScoreSortValue({}), Number.NEGATIVE_INFINITY);

  // Descending sort: scored contacts come before unscored ones, regardless of
  // whether migration 06 has populated the column.
  const rows = [
    { id: 'a', lead_score: 50 },
    { id: 'b', lead_score: null },
    { id: 'c', lead_score: 90 },
    { id: 'd' as string },
  ] as { id: string; lead_score?: number | null }[];
  const desc = [...rows].sort((x, y) => leadScoreSortValue(y) - leadScoreSortValue(x)).map((r) => r.id);
  assert.deepEqual(desc, ['c', 'a', 'b', 'd']);
});
