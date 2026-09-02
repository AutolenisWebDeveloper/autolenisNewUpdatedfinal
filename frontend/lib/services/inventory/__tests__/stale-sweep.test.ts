// Stale sweep — the predicate that decides which inventory rows get deactivated.
//
// Production evidence this suite encodes (read 2026-09-02, Supabase aieybibvewmvrubcpthm):
// the sweep ran 336 times in 7 days and deactivated NOTHING while 95 rows sat active and
// unseen for 3+ months. It was not crashing. Its predicate could not match them:
//
//   SELECT count(*) FROM inventory_items
//    WHERE last_seen_at < now() - interval '48 hours'
//      AND lane <> 'LANE_1' AND is_active = true;   -- the sweep's exact clause
//   -- → 0
//
// All 95 carry lane='LANE_1' with dealer_id IS NULL. `lane != LANE_1` was standing in for
// "dealer-verified, never auto-deactivate", and for these rows the proxy is false — they are
// open-market listings mislabeled LANE_1 by an older ingestion path. One of the 95 also has
// last_seen_at IS NULL, which Prisma's `{ lt: cutoff }` silently excludes (SQL NULL < x is NULL).
//
//   npx tsx --test lib/services/inventory/__tests__/stale-sweep.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { isStaleSweepable, staleSweepWhere, CURATED_SOURCE_ADAPTERS } from "@/lib/services/inventory/stale-sweep.service";

const NOW = new Date("2026-09-02T18:00:00.000Z");
const STALE = new Date("2026-06-01T00:00:00.000Z");   // ~3 months old
const FRESH = new Date("2026-09-02T12:00:00.000Z");   // 6h ago

type Item = Parameters<typeof isStaleSweepable>[0];

const base: Item = {
  isActive: true,
  lane: "LANE_3",
  dealerId: null,
  addedByAdminId: null,
  sourceAdapter: "marketcheck",
  lastSeenAt: FRESH,
  createdAt: STALE,
};

// ── The 95 production rows ───────────────────────────────────────────────────

test("REPRODUCTION: a LANE_1 row with NO dealer is sweepable (the 94 prod orphans)", () => {
  assert.equal(
    isStaleSweepable({ ...base, lane: "LANE_1", sourceAdapter: null, lastSeenAt: STALE }, NOW),
    true,
    "lane != LANE_1 protected rows nobody owns — the predicate must test dealer linkage, not the label",
  );
});

test("REPRODUCTION: lastSeenAt NULL falls back to createdAt (the 1 remaining prod orphan)", () => {
  assert.equal(
    isStaleSweepable({ ...base, lane: "LANE_1", sourceAdapter: null, lastSeenAt: null, createdAt: STALE }, NOW),
    true,
    "Prisma { lt: cutoff } silently excludes NULLs — a NULL last_seen_at must not be unreachable",
  );
});

test("a row created minutes ago with no lastSeenAt is NOT swept before its first sync", () => {
  assert.equal(
    isStaleSweepable({ ...base, lastSeenAt: null, createdAt: new Date(NOW.getTime() - 10 * 60_000) }, NOW),
    false,
  );
});

// ── What the LANE_1 guard was actually standing in for ───────────────────────

test("dealer-OWNED LANE_1 inventory is protected however stale", () => {
  assert.equal(
    isStaleSweepable({ ...base, lane: "LANE_1", dealerId: "dealer_1", lastSeenAt: STALE }, NOW),
    false,
  );
});

test("REGRESSION: dealer-owned LANE_2/LANE_3 stay sweepable", () => {
  // The cron's dealer stale-listing removal email selects rows with dealerId != null.
  // If the new predicate pinned dealerId: null, that email would become unreachable
  // dead code while the change advertised itself as a fix.
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_2", dealerId: "d1", lastSeenAt: STALE }, NOW), true);
  assert.equal(isStaleSweepable({ ...base, lane: "LANE_3", dealerId: "d1", lastSeenAt: STALE }, NOW), true);
});

// ── Human-curated rows have no feed to vanish from ───────────────────────────

test("admin-entered vehicles are exempt", () => {
  assert.equal(isStaleSweepable({ ...base, addedByAdminId: "admin_1", lastSeenAt: STALE }, NOW), false);
});

test("historical curated provenance is exempt even without an admin id", () => {
  for (const adapter of CURATED_SOURCE_ADAPTERS) {
    assert.equal(
      isStaleSweepable({ ...base, sourceAdapter: adapter, lastSeenAt: STALE }, NOW),
      false,
      `${adapter} rows must not be swept`,
    );
  }
});

test("an already-inactive row is never re-swept", () => {
  assert.equal(isStaleSweepable({ ...base, isActive: false, lastSeenAt: STALE }, NOW), false);
});

test("a freshly-seen row is never swept", () => {
  assert.equal(isStaleSweepable({ ...base, lastSeenAt: FRESH }, NOW), false);
});

// ── Three-valued logic guard ─────────────────────────────────────────────────

test("curated exclusion is an OR on null, never a bare NOT-IN", () => {
  // SQL `NULL NOT IN (...)` evaluates to NULL, not TRUE. Written as
  // `NOT: { sourceAdapter: { in: [...] } }` the clause would silently re-protect every
  // row with a NULL source_adapter — which is all 95 targets. The fix would ship,
  // typecheck, run green, and change nothing.
  const w = JSON.stringify(staleSweepWhere(NOW));
  assert.ok(w.includes('"sourceAdapter":null'), "must OR on sourceAdapter:null");
  assert.ok(!/"NOT":\s*\{\s*"sourceAdapter"/.test(w), "must not use a bare NOT/in form");
});

test("freshness clause carries an explicit NULL branch", () => {
  const w = JSON.stringify(staleSweepWhere(NOW));
  assert.ok(w.includes('"lastSeenAt":null'), "must handle NULL last_seen_at explicitly");
  assert.ok(w.includes('"createdAt"'), "must fall back to createdAt for NULL last_seen_at");
});

// ── Fixture parity with the real production composition ──────────────────────

test("selects exactly the production set: 95 orphans + 1 dealer-owned LANE_2", () => {
  const items: Item[] = [
    // 94 LANE_1 orphans, no dealer, no provenance
    ...Array.from({ length: 94 }, () => ({
      ...base, lane: "LANE_1", sourceAdapter: null, lastSeenAt: STALE,
    })),
    // 1 LANE_1 orphan with a NULL lastSeenAt
    { ...base, lane: "LANE_1", sourceAdapter: null, lastSeenAt: null, createdAt: STALE },
    // protected: dealer-owned LANE_1
    { ...base, lane: "LANE_1", dealerId: "d1", lastSeenAt: STALE },
    // sweepable: dealer-owned LANE_2 (keeps the removal email reachable)
    { ...base, lane: "LANE_2", dealerId: "d1", lastSeenAt: STALE },
    // protected: admin-curated
    { ...base, addedByAdminId: "a1", lastSeenAt: STALE },
    // protected: fresh LANE_3 (the 53 live rows)
    { ...base, lastSeenAt: FRESH },
  ];
  const selected = items.filter((i) => isStaleSweepable(i, NOW));
  assert.equal(selected.length, 96, "95 orphans + the dealer-owned LANE_2");
});
