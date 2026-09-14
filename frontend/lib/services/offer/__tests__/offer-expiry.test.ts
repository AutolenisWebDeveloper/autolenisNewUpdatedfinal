// §8a / parity row A16b — OFFER EXPIRATION: the default window, the sweep, and the one predicate
// that decides whether an offer may be shown and selected.
//
// THE OBVIOUS DEFAULT IS WRONG, AND THIS FILE EXISTS BECAUSE IT WAS BRIEFLY SHIPPED. Defaulting
// `offers.expires_at` to `auction.endsAt` reads as "an offer cannot outlive the window it was made
// in", and it breaks selection completely: `processAuctionClose` runs when `endsAt <= now`, so
// every offer would be expired at the exact moment the buyer is first shown it — an empty Best
// Price Report, every selection refused with `OFFER_EXPIRED`, and every auction falling into the
// zero-offer branch. §9 says the opposite ("Remind the buyer BEFORE offers expire"), which only
// means anything if the expiration is after the close.
//
// A16b calls the default a "policy window"; `OFFER_VALIDITY_HOURS` is it, and it opens at the
// close rather than at submission so every offer on one auction lapses together. Staggered
// expiries would drop rows out of the report while the buyer was reading it, and the dealership
// that bid first would lose its place for having answered promptly.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/offer/__tests__/offer-expiry.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { OFFER_VALIDITY_HOURS } from "@/lib/constants";
import {
  defaultOfferExpiry,
  qualifiedOfferWhere,
  isQualifiedOffer,
  lapsedOfferWhere,
} from "../offer-validity";

const HOUR = 3_600_000;
const NOW = new Date("2026-09-13T12:00:00.000Z");

// ── the default window ──────────────────────────────────────────────────────────────────────────

test("the default expiry opens at the CLOSE, not at the close itself", async () => {
  const closesAt = new Date(NOW.getTime() + 4 * HOUR);
  const expiry = defaultOfferExpiry(closesAt, NOW);
  assert.equal(expiry.getTime(), closesAt.getTime() + OFFER_VALIDITY_HOURS * HOUR);
  assert.ok(expiry.getTime() > closesAt.getTime(), "an offer that expires at the close can never be selected");
});

test("two dealers who bid hours apart get the SAME expiry", async () => {
  // The window is the buyer's selection window, not a per-dealer clock. Measuring from submission
  // would shed offers from the ranked report one at a time and punish the dealer who answered first.
  const closesAt = new Date(NOW.getTime() + 10 * HOUR);
  const early = defaultOfferExpiry(closesAt, NOW);
  const late = defaultOfferExpiry(closesAt, new Date(NOW.getTime() + 9 * HOUR));
  assert.equal(early.getTime(), late.getTime());
});

test("with no deadline on the auction the window opens now — shorter, never longer", async () => {
  assert.equal(defaultOfferExpiry(null, NOW).getTime(), NOW.getTime() + OFFER_VALIDITY_HOURS * HOUR);
  // A close already in the past is the same case: it cannot extend the window.
  const past = new Date(NOW.getTime() - HOUR);
  assert.equal(defaultOfferExpiry(past, NOW).getTime(), NOW.getTime() + OFFER_VALIDITY_HOURS * HOUR);
});

// ── the qualification predicate ─────────────────────────────────────────────────────────────────

test("the `where` fragment and the in-memory predicate agree on every case", async () => {
  // They are written next to each other precisely so they cannot drift: the close path counts
  // through the fragment and the send-time recheck re-counts through the same three conditions.
  // A disagreement means telling a buyer their offers are ready and then showing an empty report.
  const where = qualifiedOfferWhere(NOW);
  assert.equal(where.status, "SUBMITTED");
  assert.equal(where.isDisqualified, false);
  assert.deepEqual(where.OR, [{ expiresAt: null }, { expiresAt: { gt: NOW } }]);

  const cases = [
    { row: { status: "SUBMITTED", isDisqualified: false, expiresAt: null }, want: true },
    { row: { status: "SUBMITTED", isDisqualified: false, expiresAt: new Date(NOW.getTime() + HOUR) }, want: true },
    { row: { status: "SUBMITTED", isDisqualified: false, expiresAt: new Date(NOW.getTime() - 1) }, want: false },
    { row: { status: "SUBMITTED", isDisqualified: false, expiresAt: NOW }, want: false },
    { row: { status: "SUBMITTED", isDisqualified: true, expiresAt: null }, want: false },
    { row: { status: "WITHDRAWN", isDisqualified: false, expiresAt: null }, want: false },
    { row: { status: "DRAFT", isDisqualified: false, expiresAt: null }, want: false },
    { row: { status: "ACCEPTED", isDisqualified: false, expiresAt: null }, want: false },
    { row: { status: "EXPIRED", isDisqualified: false, expiresAt: null }, want: false },
    { row: { status: "DECLINED", isDisqualified: false, expiresAt: null }, want: false },
  ] as const;
  for (const c of cases) {
    assert.equal(isQualifiedOffer(c.row, NOW), c.want, `${c.row.status}/${String(c.row.expiresAt)}`);
  }
});

test("a NULL expiry qualifies — a pre-Phase-6 row is not silently deleted from the report", async () => {
  assert.equal(isQualifiedOffer({ status: "SUBMITTED", isDisqualified: false, expiresAt: null }, NOW), true);
});

test("`expiresAt` exactly equal to now is expired, not qualified", async () => {
  // The boundary matters: the sweep uses `lte` and the qualification uses `gt`, so a row on the
  // exact millisecond must be claimed by exactly one of them. Both agree it is lapsed.
  assert.equal(isQualifiedOffer({ status: "SUBMITTED", isDisqualified: false, expiresAt: NOW }, NOW), false);
  const lapsed = lapsedOfferWhere(NOW);
  assert.deepEqual(lapsed.expiresAt, { not: null, lte: NOW });
});

test("the sweep never touches a row with no expiry", async () => {
  // `{ lte: now }` alone would be true for NULL in some query shapes; `not: null` makes it explicit
  // that a legacy row with no expiration is left alone rather than swept to EXPIRED.
  const lapsed = lapsedOfferWhere(NOW);
  assert.equal((lapsed.expiresAt as { not: unknown }).not, null);
  assert.equal(lapsed.status, "SUBMITTED");
});
