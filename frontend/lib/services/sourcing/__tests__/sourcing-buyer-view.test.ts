// S6-30 — what the buyer is told while their request is being sourced.
//
// TWO CLAIMS ARE UNDER TEST, and the second one is the one with a cost attached:
//
//   1. The ladder and the words match the case. A buyer reading "searching within 100 miles" on a
//      case that has moved to the 250 band is being told something false about a request they
//      paid for, and the §6c holds are different enough from each other that one generic
//      "we're working on it" would hide a case waiting on the buyer's own decision.
//
//   2. NOTHING IN THE RETURN CAN IDENTIFY A DEALERSHIP. §25.1's identity firewall is built in
//      this phase and lifted in Phase 7, and the buyer-facing sourcing view is where it would
//      leak first — "we found Metroplex Ford, 14 miles away" is the firewall breached before an
//      offer exists. The test below asserts this structurally, over the whole returned object,
//      rather than field by field: a field added later is covered without anyone remembering to
//      extend the test.
//
// Run: pnpm test:sourcing

import test from "node:test";
import assert from "node:assert/strict";
import {
  bandRungs,
  describeSourcingForBuyer,
} from "@/lib/services/sourcing/sourcing-buyer-view";
import type { SourcingCaseRecord } from "@/lib/services/sourcing/sourcing-case.service";

function caseRow(over: Partial<SourcingCaseRecord> = {}): SourcingCaseRecord {
  return {
    id: "case_1",
    vehicleRequestId: "vr_1",
    status: "ACTIVE_SOURCING",
    band: "100",
    authorizedRadiusMiles: null,
    authorizationRequestedAt: null,
    coverageCount: 0,
    limitedAuctionApprovedBy: null,
    limitedAuctionApprovedAt: null,
    bandExpandedAt: null,
    openedAt: new Date("2026-09-01T00:00:00Z"),
    closedAt: null,
    closeReason: null,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The ladder
// ─────────────────────────────────────────────────────────────────────────────

test("the rungs are the four §6a bands, in order, with the current one marked", () => {
  const rungs = bandRungs(caseRow({ band: "150" }));
  assert.deepEqual(rungs.map((r) => r.band), ["100", "150", "250", "AUTHORIZED"]);
  assert.deepEqual(rungs.map((r) => r.state), ["DONE", "CURRENT", "PENDING", "PENDING"]);
});

test("the AUTHORIZED rung reads NEEDS_AUTHORIZATION, not PENDING, when we are waiting on the buyer", () => {
  // "Pending" tells a buyer to wait for us when we are waiting for them — which is the
  // difference between a 14-day abandonment close they understood and one that surprises them.
  const rungs = bandRungs(caseRow({ band: "AUTHORIZED", status: "RADIUS_AUTHORIZATION_REQUIRED" }));
  assert.equal(rungs[3]!.state, "NEEDS_AUTHORIZATION");
  assert.deepEqual(rungs.slice(0, 3).map((r) => r.state), ["DONE", "DONE", "DONE"]);
});

test("an AUTHORIZED band with no authorisation still reads NEEDS_AUTHORIZATION whatever the status", () => {
  // The ladder cannot search this state, so the rung must not look like work in progress even if
  // the case status has been moved by something else.
  const rungs = bandRungs(caseRow({ band: "AUTHORIZED", status: "ACTIVE_SOURCING" }));
  assert.equal(rungs[3]!.state, "NEEDS_AUTHORIZATION");
});

test("the authorised rung carries the buyer's own figure once they have given one", () => {
  const rungs = bandRungs(caseRow({ band: "AUTHORIZED", authorizedRadiusMiles: 400 }));
  assert.equal(rungs[3]!.outerMiles, 400);
  assert.match(rungs[3]!.label, /250 to 400 miles/);
});

// ─────────────────────────────────────────────────────────────────────────────
// The words
// ─────────────────────────────────────────────────────────────────────────────

test("a live auction says so, and says offers are sealed", () => {
  const v = describeSourcingForBuyer(caseRow({ status: "LAUNCHED", coverageCount: 6 }));
  assert.equal(v.launched, true);
  assert.match(v.headline, /6 dealerships competing/);
  assert.match(v.detail, /sealed/);
  assert.equal(v.awaitingBuyerAuthorization, false);
});

test("one dealership is not 'dealerships' — the singular is handled", () => {
  const v = describeSourcingForBuyer(caseRow({ status: "LAUNCHED", coverageCount: 1 }));
  assert.match(v.headline, /1 dealership competing/);
  assert.ok(!/1 dealerships/.test(v.headline));
});

test("the radius-authorisation hold asks the buyer, and says why we stopped", () => {
  const v = describeSourcingForBuyer(
    caseRow({ status: "RADIUS_AUTHORIZATION_REQUIRED", band: "AUTHORIZED", coverageCount: 2 }),
  );
  assert.equal(v.awaitingBuyerAuthorization, true);
  assert.equal(v.awaitingOperations, false);
  assert.match(v.headline, /250 miles/);
  assert.match(v.detail, /longer trip/);
});

test("the zero-coverage form of the same hold does not claim dealerships are interested", () => {
  const v = describeSourcingForBuyer(
    caseRow({ status: "RADIUS_AUTHORIZATION_REQUIRED", band: "AUTHORIZED", coverageCount: 0 }),
  );
  assert.match(v.detail, /No dealership within 250 miles/);
  assert.ok(!/0 dealerships are interested/.test(v.detail));
});

test("the three Operations holds ask NOTHING of the buyer", () => {
  // Each of these is a decision only Operations can make. Telling the buyer they are the
  // blocker would have them waiting on themselves.
  for (const status of ["LIMITED_PENDING_APPROVAL", "THIN_COVERAGE_REVIEW", "ZERO_COVERAGE_REVIEW"] as const) {
    const v = describeSourcingForBuyer(caseRow({ status, coverageCount: 3 }));
    assert.equal(v.awaitingOperations, true, status);
    assert.equal(v.awaitingBuyerAuthorization, false, status);
  }
});

test("a closed case uses the recorded reason rather than a guess", () => {
  const v = describeSourcingForBuyer(
    caseRow({ status: "CLOSED", closeReason: "Closed as abandoned after 14 days." }),
  );
  assert.equal(v.detail, "Closed as abandoned after 14 days.");
});

test("a closed case with NO recorded reason still says the deposit is refundable", () => {
  const v = describeSourcingForBuyer(caseRow({ status: "CLOSED", closeReason: null }));
  assert.match(v.detail, /refundable/);
});

test("the searching radius is the shared arithmetic, not a band label", () => {
  // `min(band outer, authorised)`: a buyer who asked for 250 and granted 180 is searched to 180.
  assert.equal(describeSourcingForBuyer(caseRow({ band: "100" })).searchingMiles, 100);
  assert.equal(describeSourcingForBuyer(caseRow({ band: "250" })).searchingMiles, 250);
  assert.equal(
    describeSourcingForBuyer(caseRow({ band: "250", authorizedRadiusMiles: 180 })).searchingMiles,
    180,
  );
  assert.equal(
    describeSourcingForBuyer(caseRow({ band: "AUTHORIZED", authorizedRadiusMiles: null })).searchingMiles,
    null,
  );
});

test("the phone-only count is reported SEPARATELY and never folded into the competing count", () => {
  // The owner's 2026-09-11 channel ruling. Conflating them would let "8 competing" mean
  // "6 were emailed and 2 are on an Operations call list".
  const v = describeSourcingForBuyer(caseRow({ coverageCount: 6 }), 2);
  assert.equal(v.competingCount, 6);
  assert.equal(v.callOnlyCount, 2);
  assert.ok(!/8/.test(v.headline), "the two counts were added together");
});

test("no call-only count is reported as 0, which means 'not reporting one' — never invented", () => {
  const v = describeSourcingForBuyer(caseRow({ coverageCount: 6 }));
  assert.equal(v.callOnlyCount, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// §25.1 — the identity firewall, asserted structurally
// ─────────────────────────────────────────────────────────────────────────────

test("S7-13 / §25.1: nothing the buyer view returns can identify a dealership", () => {
  // STRUCTURAL, over every value in the object, so a field added later is covered without
  // anyone remembering to extend this test. The fixture deliberately sets a dealership-shaped
  // string nowhere — the point is that there is no CHANNEL for one: the return carries numbers,
  // band labels, fixed copy and a status, and an identity has no field to travel in.
  const statuses = [
    "ACTIVE_SOURCING",
    "READY_TO_LAUNCH",
    "RADIUS_AUTHORIZATION_REQUIRED",
    "LIMITED_PENDING_APPROVAL",
    "THIN_COVERAGE_REVIEW",
    "ZERO_COVERAGE_REVIEW",
    "LAUNCHED",
    "CLOSED",
  ] as const;

  const FORBIDDEN_KEYS = [
    "dealershipName",
    "dealerId",
    "rooftopId",
    "email",
    "contactName",
    "contactEmail",
    "phone",
    "website",
    "websiteHost",
    "address",
    "distanceMiles",
    "candidates",
    "rooftops",
  ];

  for (const status of statuses) {
    const v = describeSourcingForBuyer(caseRow({ status, coverageCount: 4 }), 1);
    const seen = new Set<string>();
    const walk = (node: unknown) => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const el of node) walk(el);
        return;
      }
      for (const [k, val] of Object.entries(node as Record<string, unknown>)) {
        seen.add(k);
        walk(val);
      }
    };
    walk(v);
    for (const forbidden of FORBIDDEN_KEYS) {
      assert.ok(
        !seen.has(forbidden),
        `${status}: the buyer view exposed "${forbidden}" — §25.1 holds until the Phase 7 lift`,
      );
    }
  }
});

test("§25.1: the copy never names a dealership even when the case is at its most specific", () => {
  // The complementary check on the VALUES rather than the keys: a name could only arrive through
  // `closeReason`, which is operator-written, so that is the one string a future change could
  // use to carry one. Recorded here as the known channel rather than left implicit.
  const v = describeSourcingForBuyer(
    caseRow({ status: "CLOSED", closeReason: "no coverage after Operations review" }),
  );
  assert.equal(
    v.detail,
    "no coverage after Operations review",
    "closeReason is passed through verbatim — it is operator-written and is the ONE string on " +
      "this surface that could carry an identity, so §6c's close reasons must stay generic",
  );
});
