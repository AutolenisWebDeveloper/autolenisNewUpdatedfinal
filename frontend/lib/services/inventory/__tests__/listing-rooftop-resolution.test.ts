// A swept listing resolves to a rooftop we already own — it never mints one.
//
// dealer_rooftops is the dealer-prospecting system's entity graph (1,422 rows). Third-party
// listing text is unverified and noisy, so it may MATCH that graph but must never write to it:
// minting a rooftop per aggregator listing would fill the outreach pipeline with dealerships
// nobody discovered, verified or deduplicated.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/listing-rooftop-resolution.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveListingRooftops,
  type ListingDealerFacts,
  type RooftopRow,
} from "../listing-rooftop-resolution.service";

// Key formats mirror what dealer-identity.service actually writes to dealer_rooftops:
// phone in E.164, name lower-cased and normalized, "|" separated. A fixture in any other
// shape would pass against itself and fail against production.
const ARLINGTON: RooftopRow = {
  id: "rt_1", displayName: "Arlington Auto Group", websiteHost: "arlingtonautogroup.com",
  phoneKey: "+18175550142", nameZipKey: "arlington auto group|76011",
  nameCityStateKey: "arlington auto group|arlington|tx",
  // NULL, exactly as production is: all 1,422 dealer_rooftops rows carry mc_rooftop_id
  // NULL today. The exact-match branch is therefore inert until the rooftop half is
  // filled, which §13-D8 gates — and the fixture says so rather than pretending otherwise.
  mcRooftopId: null,
};
const FORTWORTH: RooftopRow = {
  id: "rt_2", displayName: "Fort Worth Motors", websiteHost: "fwmotors.com",
  phoneKey: "+18175559999", nameZipKey: "fort worth motors|76102",
  nameCityStateKey: "fort worth motors|fort worth|tx",
  mcRooftopId: null,
};

function listing(over: Partial<ListingDealerFacts> = {}): ListingDealerFacts {
  return {
    id: "inv_1",
    externalDealerName: "Arlington Auto Group",
    externalDealerPhone: "817-555-0142",
    externalDealerZip: "76011",
    externalDealerCity: "Arlington",
    externalDealerState: "TX",
    ...over,
  };
}

/** Records every write so "never mints one" can be asserted, not assumed. */
function deps(rooftops: RooftopRow[]) {
  const linked: Array<{ id: string; rooftopId: string }> = [];
  return {
    linked,
    loadRooftops: async () => rooftops,
    linkListing: async (id: string, rooftopId: string) => { linked.push({ id, rooftopId }); },
  };
}

test("a listing matching on phone resolves to that rooftop", async () => {
  const d = deps([ARLINGTON, FORTWORTH]);
  const r = await resolveListingRooftops([listing({ externalDealerZip: null, externalDealerCity: null })], d);
  assert.equal(r.resolved, 1);
  assert.deepEqual(d.linked, [{ id: "inv_1", rooftopId: "rt_1" }]);
});

test("a listing matching on name+zip resolves", async () => {
  const d = deps([ARLINGTON, FORTWORTH]);
  const r = await resolveListingRooftops([listing({ externalDealerPhone: null, externalDealerCity: null })], d);
  assert.equal(r.resolved, 1);
  assert.equal(d.linked[0]?.rooftopId, "rt_1");
});

test("a listing matching on name+city+state resolves", async () => {
  const d = deps([ARLINGTON, FORTWORTH]);
  const r = await resolveListingRooftops([listing({ externalDealerPhone: null, externalDealerZip: null })], d);
  assert.equal(r.resolved, 1);
  assert.equal(d.linked[0]?.rooftopId, "rt_1");
});

test("an unknown dealership resolves to nothing and MINTS nothing", async () => {
  const d = deps([ARLINGTON, FORTWORTH]);
  const r = await resolveListingRooftops(
    [listing({ externalDealerName: "Nowhere Autos", externalDealerPhone: "555-000-0000", externalDealerZip: "99999", externalDealerCity: "Nowhere", externalDealerState: "ZZ" })],
    d,
  );
  assert.equal(r.resolved, 0);
  assert.equal(r.unmatched, 1);
  assert.deepEqual(d.linked, [], "no link written");
  assert.equal(r.created, 0, "listings never create rooftops");
});

test("an AMBIGUOUS match resolves to nothing rather than guessing", async () => {
  // Two rooftops share the phone — a shared switchboard across a dealer group.
  const twin = { ...FORTWORTH, id: "rt_3", phoneKey: ARLINGTON.phoneKey };
  const d = deps([ARLINGTON, twin]);
  const r = await resolveListingRooftops(
    [listing({ externalDealerZip: null, externalDealerCity: null, externalDealerState: null })],
    d,
  );
  assert.equal(r.resolved, 0);
  assert.equal(r.ambiguous, 1);
  assert.deepEqual(d.linked, [], "an ambiguous match must not be auto-merged");
});

test("a listing with no dealer facts is skipped without querying identity", async () => {
  const d = deps([ARLINGTON]);
  const r = await resolveListingRooftops(
    [listing({ externalDealerName: null, externalDealerPhone: null, externalDealerZip: null, externalDealerCity: null, externalDealerState: null })],
    d,
  );
  assert.equal(r.skipped, 1);
  assert.deepEqual(d.linked, []);
});

test("sparse facts do not collapse onto each other — null keys never match", async () => {
  const sparseRooftop: RooftopRow = {
    id: "rt_sparse", displayName: "X", websiteHost: null, phoneKey: null,
    nameZipKey: null, nameCityStateKey: null, mcRooftopId: null,
  };
  const d = deps([sparseRooftop]);
  const r = await resolveListingRooftops(
    [listing({ externalDealerName: "Y", externalDealerPhone: null, externalDealerZip: null, externalDealerCity: null, externalDealerState: null })],
    d,
  );
  assert.equal(r.resolved, 0);
  assert.deepEqual(d.linked, []);
});

test("many listings from one dealership resolve with ONE rooftop load", async () => {
  let loads = 0;
  const d = {
    ...deps([ARLINGTON]),
    loadRooftops: async () => { loads++; return [ARLINGTON]; },
  };
  const listings = Array.from({ length: 50 }, (_, i) => listing({ id: `inv_${i}` }));
  const r = await resolveListingRooftops(listings, d);
  assert.equal(loads, 1, "a 500-listing sweep must not issue 500 rooftop queries");
  assert.equal(r.resolved, 50);
});

test("a link failure is contained — one bad row never aborts the batch", async () => {
  const d = deps([ARLINGTON]);
  const failing = {
    ...d,
    linkListing: async (id: string, rooftopId: string) => {
      if (id === "inv_2") throw new Error("write conflict");
      d.linked.push({ id, rooftopId });
    },
  };
  const r = await resolveListingRooftops(
    [listing({ id: "inv_1" }), listing({ id: "inv_2" }), listing({ id: "inv_3" })],
    failing,
  );
  assert.equal(r.resolved, 2);
  assert.equal(r.failed, 1);
  assert.deepEqual(d.linked.map(l => l.id), ["inv_1", "inv_3"]);
});

test("an empty batch does no work at all", async () => {
  let loads = 0;
  const r = await resolveListingRooftops([], {
    loadRooftops: async () => { loads++; return []; },
    linkListing: async () => {},
  });
  assert.equal(loads, 0, "no listings means no query");
  assert.deepEqual(r, {
    resolved: 0, byRooftopId: 0, byIdentity: 0,
    unmatched: 0, ambiguous: 0, skipped: 0, failed: 0, created: 0,
  });
});

// ── The two keys Phase 4 added ─────────────────────────────────────────────

test("the provider's rooftop id is an EXACT match and short-circuits the fuzzy scan", async () => {
  // Same identifier space on both sides, so there is nothing to weigh. It is checked before
  // the identity keys and cannot be ambiguous.
  const withId: RooftopRow = { ...ARLINGTON, id: "rt_exact", mcRooftopId: "573299" };
  const d = deps([withId, FORTWORTH]);
  const r = await resolveListingRooftops(
    [listing({
      mcRooftopId: "573299",
      // Deliberately contradictory fuzzy facts. If the exact key did not win, these would
      // match nothing and the listing would be unmatched.
      externalDealerName: "Some Other Name Entirely",
      externalDealerPhone: null, externalDealerZip: null,
      externalDealerCity: null, externalDealerState: null,
    })],
    d,
  );
  assert.equal(r.resolved, 1);
  assert.equal(r.byRooftopId, 1);
  assert.equal(r.byIdentity, 0);
  assert.deepEqual(d.linked, [{ id: "inv_1", rooftopId: "rt_exact" }]);
});

test("a listing whose rooftop id matches NOTHING we own falls through to the fuzzy keys", async () => {
  // A rooftop outside the graph. Phase 5's problem (and §13-D8's, since minting from
  // listing data is what the terms question gates) — but the same dealership may already
  // be in the graph under a name discovery found, so the fuzzy path must still run.
  const d = deps([ARLINGTON]);
  const r = await resolveListingRooftops([listing({ mcRooftopId: "999999" })], d);
  assert.equal(r.resolved, 1, "matched on the identity keys instead");
  assert.equal(r.byRooftopId, 0);
  assert.equal(r.byIdentity, 1);
});

test("the listing's website resolves the rooftop — the key that works TODAY", async () => {
  // websiteHost is @unique on dealer_rooftops and the table has no phone or email column,
  // so this is the highest-precision key the fuzzy path has. It was hard-coded null before
  // Phase 4, with a comment saying listings carry no website — true only because the
  // adapter discarded dealer.website at its type boundary.
  const d = deps([ARLINGTON, FORTWORTH]);
  const r = await resolveListingRooftops(
    [listing({
      externalDealerWebsite: "https://www.arlingtonautogroup.com/inventory",
      externalDealerName: null, externalDealerPhone: null,
      externalDealerZip: null, externalDealerCity: null, externalDealerState: null,
    })],
    d,
  );
  assert.equal(r.resolved, 1, "the host alone is enough");
  assert.equal(r.byIdentity, 1);
  assert.deepEqual(d.linked, [{ id: "inv_1", rooftopId: "rt_1" }]);
});

test("a website that matches no rooftop leaves the listing unlinked, never guessed", async () => {
  const d = deps([ARLINGTON]);
  const r = await resolveListingRooftops(
    [listing({
      externalDealerWebsite: "unknown-dealer.example",
      externalDealerName: null, externalDealerPhone: null,
      externalDealerZip: null, externalDealerCity: null, externalDealerState: null,
    })],
    d,
  );
  assert.equal(r.resolved, 0);
  assert.equal(r.unmatched, 1);
  assert.deepEqual(d.linked, []);
});

test("MATCH-never-MINT still holds for every new key", async () => {
  // The invariant the whole service exists to keep. dealer_rooftops is the prospecting
  // system's entity graph, populated by discovery -> verification -> dedup -> ingestion;
  // creating a rooftop from third-party listing text would fill the outreach pipeline with
  // dealerships nobody verified and bypass the one sanctioned write path.
  const d = deps([]);
  const r = await resolveListingRooftops(
    [listing({ mcRooftopId: "573299", externalDealerWebsite: "brand-new.example" })],
    d,
  );
  assert.equal(r.created, 0, "always 0 — asserted rather than assumed");
  assert.equal(r.resolved, 0);
  assert.deepEqual(d.linked, []);
});
