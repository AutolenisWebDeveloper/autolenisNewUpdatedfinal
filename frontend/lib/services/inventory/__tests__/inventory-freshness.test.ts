// Inventory freshness policy — the stale-sweep predicate and the shortlist gate.
//
// Written failing-first against the production defect: on 2026-09-02 the
// inventory-stale-sweep cron had been running every 30 minutes, COMPLETED, with
// `deactivated: 0`, while 95 rows sat active with last_seen_at up to four months
// old. Every one of those rows was LANE_1 with dealer_id NULL — they claimed the
// "never auto-deactivate dealer-verified Lane 1" exemption without the dealer
// link that exemption exists to protect. One of them had last_seen_at NULL, which
// no `lastSeenAt < cutoff` predicate can ever match.
//
//   npx tsx --test lib/services/inventory/__tests__/inventory-freshness.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  FRESHNESS_WINDOW_MS,
  STALE_FLAG_WINDOW_MS,
  SHORTLIST_MAX_AGE_MS,
  staleReferenceAt,
  isSweepExempt,
  isStaleForSweep,
  staleSweepWhere,
  listingFreshness,
  isShortlistEligible,
  shortlistEligibleWhere,
} from "@/lib/services/inventory/inventory-eligibility";

const NOW = new Date("2026-09-02T18:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

/** The exact shape of the 94 immortal production rows. */
const ORPHAN = {
  isActive: true,
  lane: "LANE_1",
  dealerId: null as string | null,
  addedByAdminId: null as string | null,
  sourceAdapter: null as string | null,
  lastSeenAt: new Date(NOW.getTime() - 90 * DAY) as Date | null,
  createdAt: new Date(NOW.getTime() - 120 * DAY),
};

describe("staleReferenceAt — the timestamp staleness is measured from", () => {
  test("uses lastSeenAt when present", () => {
    const seen = new Date(NOW.getTime() - 5 * DAY);
    assert.equal(staleReferenceAt({ lastSeenAt: seen, createdAt: ORPHAN.createdAt }).getTime(), seen.getTime());
  });

  test("falls back to createdAt when lastSeenAt is NULL", () => {
    // The 1 production row with last_seen_at NULL. `lastSeenAt < cutoff` is
    // UNKNOWN for NULL in SQL, so without this fallback the row is immortal in
    // every lane, forever.
    assert.equal(
      staleReferenceAt({ lastSeenAt: null, createdAt: ORPHAN.createdAt }).getTime(),
      ORPHAN.createdAt.getTime(),
    );
  });
});

describe("isSweepExempt — what the LANE_1 exemption actually meant", () => {
  test("dealer-managed inventory (LANE_1 + dealerId) is exempt", () => {
    assert.equal(isSweepExempt({ ...ORPHAN, dealerId: "dealer_1" }), true);
  });

  test("admin-curated inventory (addedByAdminId) is exempt in any lane", () => {
    assert.equal(isSweepExempt({ ...ORPHAN, addedByAdminId: "admin_1" }), true);
  });

  test("REGRESSION: a dealer row demoted out of LANE_1 keeps its exemption", () => {
    // The aggregator upsert recomputes `lane` via assignLane(), which can only
    // return LANE_2/LANE_3, and admin bulk-lane can move a row too. Neither
    // touches dealerId — so keying on lane would strip a dealer's own inventory
    // of its protection whenever its VIN showed up in a feed.
    const demoted = { ...ORPHAN, lane: "LANE_3", dealerId: "dealer_1" };
    assert.equal(isSweepExempt(demoted), true);
  });

  test("REGRESSION: LANE_1 with NO dealer link is NOT exempt", () => {
    // The defect. 95 production rows were LANE_1/dealer_id NULL and therefore
    // unreachable by a `lane != LANE_1` predicate.
    assert.equal(isSweepExempt(ORPHAN), false);
  });

  test("an aggregator row is never exempt even though it has provenance", () => {
    // sourceAdapter is deliberately absent from isSweepExempt's input: it is
    // provenance, not stewardship, and MarketCheck rows must age out.
    const aggregatorRow = { ...ORPHAN, sourceAdapter: "marketcheck" };
    assert.equal(isSweepExempt(aggregatorRow), false);
  });
});

describe("isStaleForSweep", () => {
  test("REGRESSION: the 94-row orphan cohort is swept", () => {
    assert.equal(isStaleForSweep(ORPHAN, NOW), true);
  });

  test("REGRESSION: the NULL-lastSeenAt orphan is swept via createdAt", () => {
    assert.equal(isStaleForSweep({ ...ORPHAN, lastSeenAt: null }, NOW), true);
  });

  test("a row created moments ago with no lastSeenAt is NOT swept", () => {
    assert.equal(
      isStaleForSweep({ ...ORPHAN, lastSeenAt: null, createdAt: new Date(NOW.getTime() - 1000) }, NOW),
      false,
      "the createdAt fallback must not sweep a row that has simply not been stamped yet",
    );
  });

  test("a fresh aggregator row is not swept", () => {
    assert.equal(
      isStaleForSweep({ ...ORPHAN, lastSeenAt: new Date(NOW.getTime() - 1000) }, NOW),
      false,
    );
  });

  test("a stale but dealer-managed row is not swept", () => {
    assert.equal(isStaleForSweep({ ...ORPHAN, dealerId: "dealer_1" }, NOW), false);
  });

  test("an already-inactive row is not swept again", () => {
    assert.equal(isStaleForSweep({ ...ORPHAN, isActive: false }, NOW), false);
  });

  test("the cutoff is exactly FRESHNESS_WINDOW_MS behind now", () => {
    const justInside = { ...ORPHAN, lastSeenAt: new Date(NOW.getTime() - FRESHNESS_WINDOW_MS + 1000) };
    const justOutside = { ...ORPHAN, lastSeenAt: new Date(NOW.getTime() - FRESHNESS_WINDOW_MS - 1000) };
    assert.equal(isStaleForSweep(justInside, NOW), false);
    assert.equal(isStaleForSweep(justOutside, NOW), true);
  });
});

describe("staleSweepWhere — the Prisma fragment stays in lock-step with the predicate", () => {
  test("selects only active rows", () => {
    assert.equal(staleSweepWhere(NOW).isActive, true);
  });

  test("REGRESSION: exemption is dealer-linked, never lane alone", () => {
    const where = JSON.stringify(staleSweepWhere(NOW));
    assert.ok(where.includes("dealerId"), "the exemption must be keyed on dealerId");
    assert.ok(where.includes("addedByAdminId"), "admin-curated rows must stay exempt");
    assert.ok(
      !/"lane":\{"not":"LANE_1"\}/.test(where),
      "a bare `lane != LANE_1` filter is the defect — it exempted 95 dealer-less rows",
    );
  });

  test("REGRESSION: NULL lastSeenAt is reachable", () => {
    const where = JSON.stringify(staleSweepWhere(NOW));
    assert.ok(
      where.includes("createdAt"),
      "rows with no lastSeenAt must be swept on createdAt, or they are immortal",
    );
  });
});

describe("listingFreshness — 7-day stale flag, 30-day shortlist cutoff", () => {
  const item = (days: number) => ({
    lastSeenAt: new Date(NOW.getTime() - days * DAY) as Date | null,
    createdAt: new Date(NOW.getTime() - 200 * DAY),
  });

  test("windows are 7 and 30 days", () => {
    assert.equal(STALE_FLAG_WINDOW_MS, 7 * DAY);
    assert.equal(SHORTLIST_MAX_AGE_MS, 30 * DAY);
  });

  test("seen today: not stale, shortlist-eligible", () => {
    const f = listingFreshness(item(0), NOW);
    assert.equal(f.isStale, false);
    assert.equal(f.shortlistEligible, true);
  });

  test("seen 8 days ago: flagged stale, still shortlist-eligible", () => {
    const f = listingFreshness(item(8), NOW);
    assert.equal(f.isStale, true);
    assert.equal(f.shortlistEligible, true, "the stale flag must not gate the shortlist at 7 days");
  });

  test("seen 31 days ago: stale AND not shortlist-eligible", () => {
    const f = listingFreshness(item(31), NOW);
    assert.equal(f.isStale, true);
    assert.equal(f.shortlistEligible, false);
  });

  test("boundaries are exact", () => {
    assert.equal(listingFreshness({ ...item(0), lastSeenAt: new Date(NOW.getTime() - STALE_FLAG_WINDOW_MS + 1) }, NOW).isStale, false);
    assert.equal(listingFreshness({ ...item(0), lastSeenAt: new Date(NOW.getTime() - STALE_FLAG_WINDOW_MS - 1) }, NOW).isStale, true);
    assert.equal(listingFreshness({ ...item(0), lastSeenAt: new Date(NOW.getTime() - SHORTLIST_MAX_AGE_MS + 1) }, NOW).shortlistEligible, true);
    assert.equal(listingFreshness({ ...item(0), lastSeenAt: new Date(NOW.getTime() - SHORTLIST_MAX_AGE_MS - 1) }, NOW).shortlistEligible, false);
  });

  test("NULL lastSeenAt measures from createdAt, and reports lastSeenAt as null", () => {
    const f = listingFreshness({ lastSeenAt: null, createdAt: new Date(NOW.getTime() - 40 * DAY) }, NOW);
    assert.equal(f.lastSeenAt, null, "the raw signal must not be fabricated for the UI");
    assert.equal(f.isStale, true);
    assert.equal(f.shortlistEligible, false);
  });

  test("no lane exemption — a dealer row unseen for 31 days is not shortlist-eligible", () => {
    // Every dealer write path stamps lastSeenAt, so for dealer inventory this
    // measures time since the dealer last touched the row. That is the point.
    const f = listingFreshness(item(31), NOW);
    assert.equal(f.shortlistEligible, false);
  });
});

describe("isShortlistEligible / shortlistEligibleWhere", () => {
  const base = {
    isActive: true,
    lastSeenAt: new Date(NOW.getTime() - 2 * DAY) as Date | null,
    createdAt: new Date(NOW.getTime() - 100 * DAY),
  };

  test("fresh active listing is eligible", () => {
    assert.equal(isShortlistEligible(base, NOW), true);
  });

  test("deactivated listing is NOT eligible", () => {
    assert.equal(
      isShortlistEligible({ ...base, isActive: false }, NOW),
      false,
      "a swept row is one the source stopped listing — shortlisting it sends a buyer after a sold car",
    );
  });

  test("listing unseen for 31 days is NOT eligible", () => {
    assert.equal(isShortlistEligible({ ...base, lastSeenAt: new Date(NOW.getTime() - 31 * DAY) }, NOW), false);
  });

  test("the Prisma fragment mirrors the predicate", () => {
    const where = JSON.stringify(shortlistEligibleWhere(NOW));
    assert.ok(where.includes('"isActive":true'));
    assert.ok(where.includes("lastSeenAt"));
    assert.ok(where.includes("createdAt"), "NULL lastSeenAt must be handled here too");
  });
});

describe("the three windows are distinct and ordered", () => {
  test("48h sweep < 7d stale flag < 30d shortlist cutoff", () => {
    // Different jobs, deliberately different sizes:
    //   48h  — executable supply for matching, and the sweep cutoff
    //   7d   — a display flag only
    //   30d  — shortlist eligibility (the backstop for sweep-exempt rows)
    assert.ok(FRESHNESS_WINDOW_MS < STALE_FLAG_WINDOW_MS);
    assert.ok(STALE_FLAG_WINDOW_MS < SHORTLIST_MAX_AGE_MS);
  });
});
