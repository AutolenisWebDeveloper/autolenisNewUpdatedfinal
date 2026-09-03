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
};
const FORTWORTH: RooftopRow = {
  id: "rt_2", displayName: "Fort Worth Motors", websiteHost: "fwmotors.com",
  phoneKey: "+18175559999", nameZipKey: "fort worth motors|76102",
  nameCityStateKey: "fort worth motors|fort worth|tx",
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
    nameZipKey: null, nameCityStateKey: null,
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
  assert.deepEqual(r, { resolved: 0, unmatched: 0, ambiguous: 0, skipped: 0, failed: 0, created: 0 });
});
