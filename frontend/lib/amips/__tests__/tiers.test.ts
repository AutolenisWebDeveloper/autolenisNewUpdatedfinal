// Regression coverage for FIX 2 — the tier-set disagreement.
//
// Three files independently defined "which tiers carry market data" and
// disagreed: the assembler and quality gate used {C,D,E}, the lifecycle manager
// used {C,D,E,F}. A Tier F page was therefore certified fresh by Gate 5 and
// simultaneously treated as permanently stale by the lifecycle manager, which
// de-indexed it on its first run. These tests pin the sets together.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_DATA_TIERS,
  METRO_ASSEMBLY_TIERS,
  requiresMarketData,
  SERVABLE_LIFECYCLE_STATUSES,
  isServableLifecycleStatus,
} from "@/lib/amips/tiers";

test("MARKET_DATA_TIERS includes Tier F", () => {
  // The whole defect: F carries a metro via its own assembler branch, so it is a
  // market-backed tier and must be treated as one everywhere.
  assert.ok(MARKET_DATA_TIERS.has("F"));
  for (const t of ["C", "D", "E"]) assert.ok(MARKET_DATA_TIERS.has(t), t);
});

test("MARKET_DATA_TIERS excludes the non-market tiers", () => {
  assert.ok(!MARKET_DATA_TIERS.has("A"));
  assert.ok(!MARKET_DATA_TIERS.has("B"));
});

test("requiresMarketData agrees with MARKET_DATA_TIERS for every tier", () => {
  for (const t of ["A", "B", "C", "D", "E", "F"]) {
    assert.equal(requiresMarketData(t), MARKET_DATA_TIERS.has(t), t);
  }
});

test("METRO_ASSEMBLY_TIERS is a strict subset of MARKET_DATA_TIERS", () => {
  // Routing set is narrower by design (F returns from an earlier branch), but it
  // must never contain a tier the market-data set does not.
  for (const t of METRO_ASSEMBLY_TIERS) {
    assert.ok(MARKET_DATA_TIERS.has(t), `${t} routed to metro assembly but not market-backed`);
  }
  assert.ok(!METRO_ASSEMBLY_TIERS.has("F"));
});

test("REFRESH_REQUIRED is servable; UNDER_REVIEW and RETIRED are not", () => {
  // FIX 3. REFRESH_REQUIRED is a data-freshness reminder, not grounds for a 404.
  assert.ok(isServableLifecycleStatus("ACTIVE"));
  assert.ok(isServableLifecycleStatus("REFRESH_REQUIRED"));
  assert.ok(!isServableLifecycleStatus("UNDER_REVIEW"));
  assert.ok(!isServableLifecycleStatus("RETIRED"));
});

test("SERVABLE_LIFECYCLE_STATUSES is exactly the two servable states", () => {
  assert.deepEqual([...SERVABLE_LIFECYCLE_STATUSES].sort(), ["ACTIVE", "REFRESH_REQUIRED"]);
});
