// lib/crm/__tests__/coverage.test.ts
// Unit tests for the pure NLLB coverage summarizer.
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/coverage.test.ts
// Repo convention is node:test + node:assert (not vitest).

import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCoverage, type RawCoverageCounts } from '../coverage';

const base: RawCoverageCounts = {
  totalLive: 1000,
  doNotContact: 100,
  active: 400,
  reengagement: 100,
  suppressedStatus: 50,
  none: 350, // contactable = 900; 400+100+50+350 = 900 ✓
  uncovered: 200,
};

test('contactable excludes do_not_contact', () => {
  assert.equal(summarizeCoverage(base).contactable, 900);
});

test('covered = active + reengagement', () => {
  assert.equal(summarizeCoverage(base).covered, 500);
});

test('suppressed = do_not_contact + nurture suppressed', () => {
  assert.equal(summarizeCoverage(base).suppressed, 150);
});

test('graceNone = none - uncovered (recently contacted, not yet stale)', () => {
  assert.equal(summarizeCoverage(base).graceNone, 150);
});

test('uncoveredRate is over the contactable set', () => {
  assert.equal(summarizeCoverage(base).uncoveredRate, 200 / 900);
});

test('coverageRate is covered over contactable', () => {
  assert.equal(summarizeCoverage(base).coverageRate, 500 / 900);
});

test('status clear when zero uncovered', () => {
  assert.equal(summarizeCoverage({ ...base, none: 150, uncovered: 0 }).status, 'clear');
});

test('status attention when uncovered <= 5% of contactable', () => {
  // 40 / 900 ≈ 4.4%
  assert.equal(summarizeCoverage({ ...base, uncovered: 40 }).status, 'attention');
});

test('status critical when uncovered > 5% of contactable', () => {
  assert.equal(summarizeCoverage({ ...base, uncovered: 200 }).status, 'critical');
});

test('no divide-by-zero when nobody is contactable', () => {
  const s = summarizeCoverage({
    totalLive: 10,
    doNotContact: 10,
    active: 0,
    reengagement: 0,
    suppressedStatus: 0,
    none: 0,
    uncovered: 0,
  });
  assert.equal(s.contactable, 0);
  assert.equal(s.coverageRate, 0);
  assert.equal(s.uncoveredRate, 0);
  assert.equal(s.status, 'clear');
});

test('default stale window is 30 days', () => {
  assert.equal(summarizeCoverage(base).staleDays, 30);
  assert.equal(summarizeCoverage(base, 14).staleDays, 14);
});

test('raw planes pass through (doNotContact, suppressedStatus)', () => {
  const s = summarizeCoverage(base);
  assert.equal(s.doNotContact, 100);
  assert.equal(s.suppressedStatus, 50);
});

test('contactable partition sums to contactable', () => {
  const s = summarizeCoverage(base);
  // active + reengagement + suppressedStatus + graceNone + uncovered === contactable
  const partition = s.active + s.reengagement + s.suppressedStatus + s.graceNone + s.uncovered;
  assert.equal(partition, s.contactable);
});
