// Proof tests for the Layer-5 interest-tag classifier (Vehicle/Finance segments).
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/contact-interest-tags.proof.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { interestTagsForEvent, parseBudgetMax } from '../contact-interest-tags';

test('finance interest is derived from the event type', () => {
  assert.deepEqual(interestTagsForEvent('refinance_inquiry', {}), ['finance:refinance']);
  assert.deepEqual(interestTagsForEvent('trade_in_submitted', {}), ['finance:trade_in']);
  assert.deepEqual(interestTagsForEvent('calculator_completed', {}), ['finance:financing']);
});

test('events with no vehicle/finance signal produce no tags', () => {
  assert.deepEqual(interestTagsForEvent('buyer_signup', {}), []);
  assert.deepEqual(interestTagsForEvent('dealer_invited', { vehicle_type: 'SUV' }), []);
});

test('SUV request tags both suv and family', () => {
  const tags = interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'SUV', budget: '$30,000' });
  assert.ok(tags.includes('vehicle:suv'));
  assert.ok(tags.includes('vehicle:family'));
});

test('Van maps to family; Truck maps to truck', () => {
  assert.ok(interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Van' }).includes('vehicle:family'));
  assert.ok(interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Truck' }).includes('vehicle:truck'));
});

test('EV is detected from make and from model hints', () => {
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', make: 'Tesla' }).includes('vehicle:ev'),
  );
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'SUV', make: 'Ford', model: 'Mustang Mach-E' }).includes('vehicle:ev'),
  );
});

test('Luxury is detected from a luxury make and from a high budget', () => {
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', make: 'BMW' }).includes('vehicle:luxury'),
  );
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', budget: '$72,000' }).includes('vehicle:luxury'),
  );
  assert.ok(
    !interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', make: 'Honda', budget: '$25,000' }).includes('vehicle:luxury'),
  );
});

test('financing path maps to finance tags', () => {
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', financing_option: 'need_financing' }).includes('finance:financing'),
  );
  assert.ok(
    interestTagsForEvent('vehicle_request_submitted', { vehicle_type: 'Sedan', financing_option: 'lease' }).includes('finance:lease'),
  );
});

test('parseBudgetMax handles plain, comma, range, and k notation', () => {
  assert.equal(parseBudgetMax('$55,000'), 55000);
  assert.equal(parseBudgetMax('40000-60000'), 60000);
  assert.equal(parseBudgetMax('$60k'), 60000);
  assert.equal(parseBudgetMax('no idea'), 0);
  assert.equal(parseBudgetMax(undefined), 0);
});
