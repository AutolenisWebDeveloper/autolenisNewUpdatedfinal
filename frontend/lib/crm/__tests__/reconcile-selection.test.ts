// lib/crm/__tests__/reconcile-selection.test.ts
// Unit tests for the NLLB reconciliation selection rule + envelope helpers.
// Run with:  npx tsx --tsconfig lib/crm/__tests__/tsconfig.test.json \
//              --test lib/crm/__tests__/reconcile-selection.test.ts
//
// Repo convention is node:test + node:assert (matches the other *.test.ts in
// this folder), NOT vitest. Same cases/assertions as the runnable proof.

import test from "node:test";
import assert from "node:assert/strict";
import {
  isUncovered,
  reengageIdempotencyKey,
  buildReengageEnvelope,
  type ReconcileContactState,
} from "../reconcile-selection";

const NOW = new Date("2026-06-16T00:00:00Z");
const OPTS = { now: NOW, staleDays: 30 };
const base: ReconcileContactState = {
  do_not_contact: false,
  deleted_at: null,
  nurture_status: "none",
  last_contacted_at: null,
  created_at: "2026-01-01T00:00:00Z",
};

test("never-contacted with an old created_at is uncovered", () => {
  assert.equal(isUncovered(base, OPTS), true);
});

test("excludes soft-deleted", () => {
  assert.equal(isUncovered({ ...base, deleted_at: "2026-05-01" }, OPTS), false);
});

test("excludes do_not_contact", () => {
  assert.equal(isUncovered({ ...base, do_not_contact: true }, OPTS), false);
});

for (const s of ["active", "reengagement", "suppressed"] as const) {
  test(`excludes nurture_status=${s}`, () => {
    assert.equal(isUncovered({ ...base, nurture_status: s }, OPTS), false);
  });
}

test("excludes a recently-contacted contact", () => {
  assert.equal(
    isUncovered({ ...base, last_contacted_at: "2026-06-11T00:00:00Z" }, OPTS),
    false,
  );
});

test("includes a stale (>30d) contact", () => {
  assert.equal(
    isUncovered({ ...base, last_contacted_at: "2026-05-07T00:00:00Z" }, OPTS),
    true,
  );
});

test("treats the cutoff boundary as not-yet-stale", () => {
  assert.equal(
    isUncovered({ ...base, last_contacted_at: "2026-05-17T00:00:00Z" }, OPTS),
    false,
  );
});

test("treats an unparseable last_contacted_at as never-contacted", () => {
  assert.equal(
    isUncovered({ ...base, last_contacted_at: "not-a-date" }, OPTS),
    true,
  );
});

test("falls back to created_at when last_contacted_at is null", () => {
  assert.equal(
    isUncovered({ ...base, created_at: "2026-06-06T00:00:00Z" }, OPTS),
    false,
  );
});

test("idempotency key is day-bucketed and stable within a UTC day", () => {
  assert.equal(reengageIdempotencyKey("c1", NOW), "reengagement_sweep:c1:2026-06-16");
  assert.equal(
    reengageIdempotencyKey("c1", new Date("2026-06-16T23:59:59Z")),
    "reengagement_sweep:c1:2026-06-16",
  );
});

test("builds a Router-shaped envelope with a free-string event (no union change)", () => {
  const env = buildReengageEnvelope(
    {
      id: "c1",
      email: "a@b.com",
      phone: null,
      firstName: "A",
      lastName: null,
      consentEmail: true,
      consentSms: false,
      lifecycleStage: "lead",
    },
    { now: NOW, staleDays: 30, job: "nllb_daily" },
  );
  assert.equal(env.event, "reengagement_sweep");
  assert.equal(env.version, 1);
  assert.equal(env.contact.id, "c1");
  assert.equal(env.data.reason, "nllb_coverage_backfill");
});
