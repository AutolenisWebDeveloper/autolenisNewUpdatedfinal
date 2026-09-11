// Phase 5 — the sourcing-case state machine and the §6a band ladder.
//
// §28.3 requires transition control, and `sourcing_cases.status` is unconstrained TEXT with the
// vocabulary in code — so these assertions are the only thing standing between the §6c decision
// table and a status that means whatever the last writer thought it meant.
//
// WHY THE BAND ARITHMETIC IS TESTED AT ALL. §6a's "each expansion searches only the new band and
// reuses valid candidates already found" is §10.6 S6-09, whose status is BROKEN. The annulus —
// an inner edge as well as an outer one — is the whole mechanism, and an off-by-one there does
// not fail loudly: it silently re-validates rooftops the previous band already paid for, which is
// the 4 × 60 cost defect the independent review measured on the legacy gate.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/sourcing/__tests__/sourcing-status.test.ts"

import test, { mock } from "node:test";
import assert from "node:assert/strict";
// Type-only: the shapes under test, so the fixtures below cannot drift from them.
import type { RankedRooftop } from "@/lib/services/sourcing/rooftop-sourcing.service";

mock.module("@/lib/prisma", { namedExports: { prisma: {} } });
mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });
mock.module("@/lib/services/vehicle-request/vehicle-request-due-diligence.service", {
  namedExports: { initializeCheckpoints: async () => ({ count: 4 }) },
});

async function load() {
  return import("@/lib/services/sourcing/sourcing-case.service");
}

// ── the §6c vocabulary ────────────────────────────────────────────────────────

test("every §6c outcome has a status, and every status is one of the §6c outcomes", async () => {
  const { SOURCING_CASE_STATUS } = await load();
  // One per row of the Stage 6c decision table, plus the entry state, the launch state and the
  // terminal one. If a row of §6c gains an action, this assertion is what notices.
  assert.deepEqual(Object.keys(SOURCING_CASE_STATUS).sort(), [
    "ACTIVE_SOURCING",
    "CLOSED",
    "LAUNCHED",
    "LIMITED_PENDING_APPROVAL",
    "RADIUS_AUTHORIZATION_REQUIRED",
    "READY_TO_LAUNCH",
    "THIN_COVERAGE_REVIEW",
    "ZERO_COVERAGE_REVIEW",
  ]);
});

test("LAUNCHED is reachable ONLY from READY_TO_LAUNCH — §6c's gate cannot be stepped around", async () => {
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  const all = Object.values(S);
  for (const from of all) {
    const allowed = canTransition(from, S.LAUNCHED);
    const expected = from === S.READY_TO_LAUNCH || from === S.LAUNCHED;
    assert.equal(
      allowed,
      expected,
      `${from} -> LAUNCHED should be ${expected ? "allowed" : "refused"}`,
    );
  }
});

test("a limited auction cannot launch without passing through READY_TO_LAUNCH", async () => {
  // §6c: "3–4 | Limited auction, only with audited Operations approval." The approval is what
  // moves LIMITED_PENDING_APPROVAL -> READY_TO_LAUNCH, so a direct jump to LAUNCHED would be a
  // limited auction that launched without one.
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  assert.equal(canTransition(S.LIMITED_PENDING_APPROVAL, S.LAUNCHED), false);
  assert.equal(canTransition(S.LIMITED_PENDING_APPROVAL, S.READY_TO_LAUNCH), true);
});

test("CLOSED is terminal in this phase", async () => {
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  for (const to of Object.values(S)) {
    if (to === S.CLOSED) continue;
    assert.equal(canTransition(S.CLOSED, to), false, `CLOSED -> ${to} must be refused`);
  }
});

test("every non-terminal hold can return to ACTIVE_SOURCING", async () => {
  // Band expansion, a radius authorisation and an Operations "keep looking" all legitimately
  // resume sourcing, so the holds are not dead ends. LAUNCHED is excluded deliberately: once an
  // auction is live, re-sourcing it is Phase 6's concern, not a status flip.
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  for (const from of [
    S.READY_TO_LAUNCH,
    S.LIMITED_PENDING_APPROVAL,
    S.THIN_COVERAGE_REVIEW,
    S.ZERO_COVERAGE_REVIEW,
    S.RADIUS_AUTHORIZATION_REQUIRED,
  ]) {
    assert.equal(canTransition(from, S.ACTIVE_SOURCING), true, `${from} must be able to resume`);
  }
  assert.equal(canTransition(S.LAUNCHED, S.ACTIVE_SOURCING), false);
});

test("every status can reach CLOSED except CLOSED itself — nothing is unclosable", async () => {
  // §Stage 6's 14-day abandonment and §24's cancellation both have to be able to end a case
  // wherever it is. A status that could not close would be a case that could never be cleaned up.
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  for (const from of Object.values(S)) {
    if (from === S.CLOSED) continue;
    assert.equal(canTransition(from, S.CLOSED), true, `${from} must be closable`);
  }
});

test("a transition to the same status is idempotent rather than illegal", async () => {
  // The reconciler re-asserts an outcome on every tick. Treating that as an illegal transition
  // would fill the log with refusals for the normal case.
  const { canTransition, SOURCING_CASE_STATUS: S } = await load();
  for (const s of Object.values(S)) {
    assert.equal(canTransition(s, s), true, `${s} -> ${s} must be permitted`);
  }
});

// ── the §6a ladder ────────────────────────────────────────────────────────────

test("the band vocabulary matches the sourcing_cases_band_check CHECK exactly", async () => {
  // The database CHECK is the authority: `band IN ('100','150','250','AUTHORIZED')`
  // (Phase 1 migration.sql:141). A fifth value in code would be a 23514 at write time, on a
  // buyer's paid request.
  const { SOURCING_BAND } = await load();
  assert.deepEqual(Object.values(SOURCING_BAND).sort(), ["100", "150", "250", "AUTHORIZED"]);
});

test("the bands form a contiguous, non-overlapping ladder — the annulus that makes S6-09 true", async () => {
  const { SOURCING_BAND: B, BAND_INNER_MILES, BAND_OUTER_MILES, BAND_ORDER } = await load();
  // §6a steps 1-2 share the 100-mile rung: registered first, then outside, same radius.
  assert.equal(BAND_INNER_MILES[B.B100], 0);
  assert.equal(BAND_OUTER_MILES[B.B100], 100);
  // Each later band starts exactly where the previous one ended. A gap would silently skip
  // rooftops; an overlap would re-validate ones already paid for.
  assert.equal(BAND_INNER_MILES[B.B150], BAND_OUTER_MILES[B.B100]);
  assert.equal(BAND_INNER_MILES[B.B250], BAND_OUTER_MILES[B.B150]);
  assert.equal(BAND_INNER_MILES[B.AUTHORIZED], BAND_OUTER_MILES[B.B250]);
  // AUTHORIZED has no fixed outer edge — the buyer's number is the edge.
  assert.equal(BAND_OUTER_MILES[B.AUTHORIZED], null);
  assert.deepEqual([...BAND_ORDER], ["100", "150", "250", "AUTHORIZED"]);
});

test("nextBand walks the ladder and stops at AUTHORIZED", async () => {
  const { nextBand, SOURCING_BAND: B } = await load();
  assert.equal(nextBand(B.B100), B.B150);
  assert.equal(nextBand(B.B150), B.B250);
  assert.equal(nextBand(B.B250), B.AUTHORIZED);
  assert.equal(nextBand(B.AUTHORIZED), null);
});

test("S6-10: a buyer-authorised maximum is never exceeded, even when it is SMALLER than the band", async () => {
  // The case the arithmetic exists for. A buyer asked for authorisation at 250 and granted 180,
  // so the 250 band must search to 180 — not to 250, and not refuse to search at all. Expressed
  // as min() rather than a branch precisely so a caller cannot forget it.
  const { effectiveRadiusMiles, SOURCING_BAND: B } = await load();
  assert.equal(effectiveRadiusMiles(B.B250, 180), 180);
  assert.equal(effectiveRadiusMiles(B.B150, 120), 120);
  // And with no authorisation the band's own edge binds.
  assert.equal(effectiveRadiusMiles(B.B100, null), 100);
  assert.equal(effectiveRadiusMiles(B.B250, null), 250);
});

test("the AUTHORIZED band refuses to search without an authorisation beyond 250", async () => {
  // Returning a large number here, or Infinity, would mean a case that reached the ceiling
  // searched the whole country instead of asking the buyer. Null is "refuse", and the ladder
  // treats it as a hold.
  const { effectiveRadiusMiles, SOURCING_BAND: B } = await load();
  assert.equal(effectiveRadiusMiles(B.AUTHORIZED, null), null);
  assert.equal(effectiveRadiusMiles(B.AUTHORIZED, 250), null, "250 is the ceiling, not an extension");
  assert.equal(effectiveRadiusMiles(B.AUTHORIZED, 200), null, "below the ceiling adds nothing");
  assert.equal(effectiveRadiusMiles(B.AUTHORIZED, 400), 400);
});

test("nextBandIsSearchable gates the AUTHORIZED rung on a real authorisation", async () => {
  // §Stage 6's failure clause only fires "at 250 miles without coverage". Treating AUTHORIZED as
  // searchable without a buyer maximum would let the ladder "expand" forever and never reach
  // RADIUS_AUTHORIZATION_REQUIRED — so the buyer would never be asked.
  const { nextBandIsSearchable } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(nextBandIsSearchable("100", null), true);
  assert.equal(nextBandIsSearchable("150", null), true);
  assert.equal(nextBandIsSearchable("250", null), false, "no authorisation → ask the buyer");
  assert.equal(nextBandIsSearchable("250", 400), true, "authorised → one more rung");
  assert.equal(nextBandIsSearchable("AUTHORIZED", 400), false, "the ladder ends here");
});

test("a narrow authorisation makes the next band unsearchable rather than empty", async () => {
  // A buyer who authorises 10 extra miles from 100 has not opened the 150 band: reach (110) is
  // inside it, so there is nothing new to search and the ladder must not pretend there is.
  const { nextBandIsSearchable } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(nextBandIsSearchable("100", 110), true, "110 > the 150 band's inner edge of 100");
  assert.equal(nextBandIsSearchable("100", 100), false, "a ceiling of 100 adds no new annulus");
  assert.equal(nextBandIsSearchable("150", 150), false);
});

// ── §6c's decision table ──────────────────────────────────────────────────────

// Typed as the real `RankedRooftop` rather than inferred, so a field added to the shape breaks
// this helper instead of being silently absent from every ranking and outcome test below.
function rooftop(id: string, ready: boolean, distance = 10): RankedRooftop {
  return {
    rooftopId: id,
    validation: {
      invitationReady: ready,
      failures: ready ? [] : ["NO_DELIVERABLE_CONTACT"],
      distanceMiles: distance,
      channel: ready ? "EMAIL" : "NONE",
      roleFit: ready,
      operatingStatus: "UNKNOWN",
      contactEmail: ready ? `${id}@example.com` : null,
      contactName: null,
      contactSource: null,
    },
    band: "100",
    servedCandidateIds: [],
    source: "HOLDING",
    isRegistered: false,
    dealerId: null,
    score: 0,
    displayName: id,
    contactEmail: ready ? `${id}@example.com` : null,
    contactName: null,
  };
}

test("§6c: 5–8 ready rooftops launch automatically", async () => {
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  for (const n of [5, 6, 7, 8]) {
    const field = Array.from({ length: n }, (_, i) => rooftop(`r${i}`, true));
    const d = decideOutcome(field, 0, false);
    assert.equal(d.outcome, "AUTO_LAUNCH", `${n} ready rooftops must auto-launch`);
    assert.equal(d.field.length, n);
  }
});

test("§6c: more than 8 ranks and invites the best EIGHT", async () => {
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const field = Array.from({ length: 14 }, (_, i) => rooftop(`r${i}`, true));
  const d = decideOutcome(field, 0, false);
  assert.equal(d.outcome, "AUTO_LAUNCH");
  assert.equal(d.readyCount, 14, "the COUNT is the whole ready field");
  assert.equal(d.field.length, 8, "the FIELD is capped at eight — §33 #29's invitation budget");
});

test("§6c: 3–4 holds for an audited limited-auction approval", async () => {
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  for (const n of [3, 4]) {
    const field = Array.from({ length: n }, (_, i) => rooftop(`r${i}`, true));
    assert.equal(decideOutcome(field, 0, false).outcome, "LIMITED_PENDING_APPROVAL");
  }
});

test("§6c: 1–2 goes to review, 0 goes to zero-coverage review", async () => {
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(decideOutcome([rooftop("a", true)], 0, false).outcome, "THIN_COVERAGE_REVIEW");
  assert.equal(decideOutcome([rooftop("a", true), rooftop("b", true)], 0, false).outcome, "THIN_COVERAGE_REVIEW");
  assert.equal(decideOutcome([], 0, false).outcome, "ZERO_COVERAGE_REVIEW");
  assert.equal(decideOutcome([rooftop("a", false)], 0, false).outcome, "ZERO_COVERAGE_REVIEW");
});

test("§6a beats §6c: while a band remains, a thin field EXPANDS rather than going to review", async () => {
  // The reading that matters, and the one a literal read of the §6c table alone would get wrong.
  // "Continue expansion" is the FIRST option of the 1–2 row, and §Stage 6's failure clause only
  // triggers "at 250 miles without coverage" — so sending a buyer to Operations at 100 miles for
  // a field that 150 miles would have filled is the defect, not the remedy.
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(decideOutcome([], 0, true).outcome, "EXPAND");
  assert.equal(decideOutcome([rooftop("a", true)], 0, true).outcome, "EXPAND");
  assert.equal(decideOutcome([rooftop("a", true), rooftop("b", true), rooftop("c", true)], 0, true).outcome, "EXPAND");
  // ...but a field that already MEETS the threshold launches without waiting for another band.
  const five = Array.from({ length: 5 }, (_, i) => rooftop(`r${i}`, true));
  assert.equal(decideOutcome(five, 0, true).outcome, "AUTO_LAUNCH");
});

test("non-ready rooftops never count toward the field, however many there are", async () => {
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const field = Array.from({ length: 20 }, (_, i) => rooftop(`r${i}`, false));
  const d = decideOutcome(field, 0, false);
  assert.equal(d.readyCount, 0);
  assert.equal(d.field.length, 0);
  assert.equal(d.outcome, "ZERO_COVERAGE_REVIEW");
});

test("the CALL_ONLY count is carried separately and never inflates the field", async () => {
  // The channel decision made mechanical. A phone-only rooftop is real market that the automated
  // rail cannot reach, so it is reported — but counting it would let "invitations sent" be read
  // as "the market was reached", which is exactly what the separate count exists to prevent.
  const { decideOutcome } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const d = decideOutcome([rooftop("a", true)], 17, false);
  assert.equal(d.readyCount, 1);
  assert.equal(d.callOnlyCount, 17);
  assert.equal(d.outcome, "THIN_COVERAGE_REVIEW", "17 uncontactable rooftops do not make a field");
});

test("ranking is deterministic and total — defect 4's root cause", async () => {
  // `Array.prototype.sort` is stable, so without a final unique comparison equal elements keep
  // their input order — which for a `findMany` with no `orderBy` is database order. Two runs over
  // the same data could invite different dealerships and neither outcome was explainable.
  const { rankRooftops } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const a = { ...rooftop("bbb", true, 10), score: 50 };
  const b = { ...rooftop("aaa", true, 10), score: 50 };
  // Identical score, identical distance: the only separator left is the id.
  assert.deepEqual(rankRooftops([a, b]).map((r) => r.rooftopId), ["aaa", "bbb"]);
  assert.deepEqual(rankRooftops([b, a]).map((r) => r.rooftopId), ["aaa", "bbb"],
    "the input order must not change the result");
});

test("ranking puts registered rooftops first, then score, then distance — §6a's own order", async () => {
  const { rankRooftops } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const outsideNear = { ...rooftop("o", true, 1), score: 99, isRegistered: false };
  const registeredFar = { ...rooftop("r", true, 90), score: 1, isRegistered: true };
  assert.deepEqual(
    rankRooftops([outsideNear, registeredFar]).map((x) => x.rooftopId),
    ["r", "o"],
    "§6a step 1 is registered within 100; step 2 is outside within 100",
  );
  const hi = { ...rooftop("hi", true, 50), score: 80, isRegistered: true };
  const lo = { ...rooftop("lo", true, 5), score: 10, isRegistered: true };
  assert.deepEqual(rankRooftops([lo, hi]).map((x) => x.rooftopId), ["hi", "lo"]);
});

// ── the D36 sub-ruling on operating_status ────────────────────────────────────

test("operating_status is a NEGATIVE filter: unknown is not closed", async () => {
  // The owner's D36 sub-ruling, 2026-09-11. `dealer_rooftops.operating_status` is nullable TEXT
  // that NOTHING has ever written, so a predicate requiring 'ACTIVE' would reject all 1,422
  // rooftops and produce zero coverage for every buyer, fail-closed, in production.
  const { operatingStatusVerdict } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(operatingStatusVerdict(null), "UNKNOWN");
  assert.equal(operatingStatusVerdict(""), "UNKNOWN");
  assert.equal(operatingStatusVerdict("   "), "UNKNOWN");
  // Only an explicit statement of closure excludes.
  assert.equal(operatingStatusVerdict("CLOSED"), "CLOSED");
  assert.equal(operatingStatusVerdict("closed"), "CLOSED");
  assert.equal(operatingStatusVerdict("INACTIVE"), "CLOSED");
  assert.equal(operatingStatusVerdict("PERMANENTLY_CLOSED"), "CLOSED");
  assert.equal(operatingStatusVerdict("OUT_OF_BUSINESS"), "CLOSED");
  // Anything else positive reads as open.
  assert.equal(operatingStatusVerdict("ACTIVE"), "OK");
  assert.equal(operatingStatusVerdict("OPERATIONAL"), "OK");
});

test("§6b make fit is satisfied by EITHER signal, because `makes` is empty on most rooftops", async () => {
  const { makeFits } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  const wanted = new Set(["Toyota"]);
  // Holding one of the buyer's candidates is fit, whatever the `makes` array says.
  assert.equal(makeFits([], true, wanted), true);
  // Listing the make is fit, case-insensitively.
  assert.equal(makeFits(["toyota", "Lexus"], false, wanted), true);
  // Neither is not fit.
  assert.equal(makeFits(["Ford"], false, wanted), false);
  assert.equal(makeFits([], false, wanted), false);
});

test("§6b role fit accepts a role-derived inbox without a title", async () => {
  // A role address IS the role — §6b asks for a relevant role, not a relevant person — and
  // `ROLE_DERIVED` is precisely the status that says the address was derived from one.
  const { titleSatisfiesRoleFit } = await import("@/lib/services/sourcing/rooftop-sourcing.service");
  assert.equal(titleSatisfiesRoleFit(null, "ROLE_DERIVED"), true);
  assert.equal(titleSatisfiesRoleFit("", "ROLE_DERIVED"), true);
  // A verified person needs a relevant title.
  assert.equal(titleSatisfiesRoleFit("Internet Sales Manager", "VERIFIED"), true);
  assert.equal(titleSatisfiesRoleFit("BDC Director", "VERIFIED"), true);
  assert.equal(titleSatisfiesRoleFit("General Manager", "VERIFIED"), true);
  assert.equal(titleSatisfiesRoleFit("Service Technician", "VERIFIED"), false);
  assert.equal(titleSatisfiesRoleFit(null, "VERIFIED"), false);
});
