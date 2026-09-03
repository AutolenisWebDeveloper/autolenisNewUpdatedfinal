// The provider's `dealer` object is the only route from a swept listing to a rooftop we own.
//
// 0 of 148 active inventory rows carry a dealer_id. The adapter kept name/phone/city/state and
// discarded street, zip, coordinates, email, type and the provider's own identifiers — and never
// wrote the item's own city/state/zip/latitude/longitude columns, which is why the public
// ZIP+radius filter saw a NULL distance on every row and rendered an empty grid.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/inventory/__tests__/marketcheck-dealer-provenance.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { MarketCheckAdapter } from "../adapters/marketcheck.adapter";

/** The adapter's normalize() is private; exercise it the way the sweep does. */
function normalize(listing: Record<string, unknown>) {
  const adapter = new MarketCheckAdapter() as unknown as {
    normalize(l: unknown): Record<string, unknown> | null;
  };
  return adapter.normalize(listing);
}

const FULL_DEALER = {
  id: 1042,
  name: "Arlington Auto Group",
  street: "2200 E Copeland Rd",
  city: "Arlington",
  state: "TX",
  zip: "76011",
  latitude: 32.7451,
  longitude: -97.0836,
  phone: "817-555-0142",
  seller_email: "sales@arlingtonautogroup.com",
  dealer_type: "franchise",
  mc_rooftop_id: "rt_88213",
  mc_dealer_id: "mc_1042",
};

const LISTING = {
  vin: "1FTFW1ET5DFC10312",
  build: { year: 2022, make: "Ford", model: "F-150", trim: "XLT" },
  miles: 41_200,
  price: 38_995,
  dealer: FULL_DEALER,
};

describe("every field of the dealer object survives normalization", () => {
  const cases: Array<[string, unknown]> = [
    ["externalDealerName", "Arlington Auto Group"],
    ["externalDealerStreet", "2200 E Copeland Rd"],
    ["externalDealerCity", "Arlington"],
    ["externalDealerState", "TX"],
    ["externalDealerZip", "76011"],
    ["externalDealerPhone", "817-555-0142"],
    ["externalDealerEmail", "sales@arlingtonautogroup.com"],
    ["externalDealerType", "franchise"],
    ["mcRooftopId", "rt_88213"],
    ["mcDealerId", "mc_1042"],
    ["latitude", 32.7451],
    ["longitude", -97.0836],
  ];
  for (const [field, expected] of cases) {
    test(field, () => {
      assert.deepEqual(normalize(LISTING)?.[field], expected);
    });
  }
});

test("the item's OWN geography is written, not just the dealer's copy", () => {
  const v = normalize(LISTING)!;
  assert.equal(v.city, "Arlington");
  assert.equal(v.state, "TX");
  assert.equal(v.zip, "76011");
  assert.equal(v.latitude, 32.7451, "a NULL latitude is why the ZIP filter emptied the grid");
  assert.equal(v.longitude, -97.0836);
});

test("mc_dealer_id falls back to the numeric dealer.id when absent", () => {
  const v = normalize({ ...LISTING, dealer: { ...FULL_DEALER, mc_dealer_id: undefined } })!;
  assert.equal(v.mcDealerId, "1042", "coerced to string — the column is TEXT");
});

test("a listing with NO dealer object still normalizes; provenance is simply absent", () => {
  const v = normalize({ ...LISTING, dealer: undefined });
  assert.ok(v, "a missing dealer must never drop the vehicle");
  assert.equal(v!.externalDealerName, undefined);
  assert.equal(v!.latitude, undefined);
  assert.equal(v!.mcDealerId, undefined);
});

test("a partial dealer object keeps what it has and omits the rest", () => {
  const v = normalize({ ...LISTING, dealer: { name: "Sparse Motors", state: "TX" } })!;
  assert.equal(v.externalDealerName, "Sparse Motors");
  assert.equal(v.state, "TX");
  assert.equal(v.zip, undefined);
  assert.equal(v.latitude, undefined);
});

test("non-numeric coordinates are dropped rather than stored as NaN", () => {
  const v = normalize({
    ...LISTING,
    dealer: { ...FULL_DEALER, latitude: "not-a-number", longitude: null },
  })!;
  assert.equal(v.latitude, undefined, "NaN in a Decimal column is a write error, not a location");
  assert.equal(v.longitude, undefined);
});

test("out-of-range coordinates are rejected — they are provider noise, not places", () => {
  const v = normalize({ ...LISTING, dealer: { ...FULL_DEALER, latitude: 991, longitude: -7000 } })!;
  assert.equal(v.latitude, undefined);
  assert.equal(v.longitude, undefined);
});

test("0,0 is rejected — Null Island is the provider's missing-coordinate sentinel", () => {
  const v = normalize({ ...LISTING, dealer: { ...FULL_DEALER, latitude: 0, longitude: 0 } })!;
  assert.equal(v.latitude, undefined);
  assert.equal(v.longitude, undefined);
});

test("blank strings are omitted, never written as empty columns", () => {
  const v = normalize({
    ...LISTING,
    dealer: { ...FULL_DEALER, seller_email: "   ", street: "", dealer_type: "" },
  })!;
  assert.equal(v.externalDealerEmail, undefined);
  assert.equal(v.externalDealerStreet, undefined);
  assert.equal(v.externalDealerType, undefined);
});

test("normalization still rejects a vehicle with no price — unchanged contract", () => {
  assert.equal(normalize({ ...LISTING, price: 0 }), null);
  assert.equal(normalize({ ...LISTING, build: { year: 2022, make: "Ford" } }), null);
});
