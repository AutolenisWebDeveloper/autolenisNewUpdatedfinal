// The provider's dealership objects are the only route from a swept listing to a rooftop we own.
//
// 0 of 148 active inventory rows carried a dealer_id. The adapter kept name/phone/city/state and
// discarded street, zip, coordinates, email, type and the website — and never wrote the item's own
// city/state/zip/latitude/longitude columns, which is why the public ZIP+radius filter saw a NULL
// distance on every row and rendered an empty grid. Phase 1 added the columns; Phase 4 makes the
// adapter ASK for the objects that fill them and read the identifiers from the right one.
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

// ── THE FIXTURE IS THE POINT OF THIS FILE ───────────────────────────────────
//
// It used to place `mc_rooftop_id` and `mc_dealer_id` INSIDE `dealer`, which is where the
// adapter read them from. They are not there. The provider returns `mc_dealership` as a
// SIBLING of `dealer` on the listing root, and the identifiers live only on it. So the
// suite passed against a payload shape the provider does not send, `mcRooftopId` was
// `undefined` on every ingest, and `mcDealerId` silently stored `dealer.id` — which is
// the WEBSITE id, a different identifier space.
//
// The result was two halves of the same hole: 221 listings with no rooftop id, and all
// 1,422 `dealer_rooftops` rows with `mc_rooftop_id` NULL, and therefore no key to join
// them on. `dealer_rooftops` carries no phone or email column at all, so `website_host`
// is the only other high-precision key — and `dealer.website` was not even declared on
// the type, so it was discarded before any decision was made.
//
// Shape below transcribed from a live response, 2026-09-10, zip 76011 radius 100 with
// include_dealer_object + include_mc_dealership_object + include_build_object. The
// identity relation `dealer.id === mc_dealership.mc_website_id` held on 3/3 listings,
// and `mc_rooftop_id` was a different value on all three.

const FULL_DEALER = {
  id: 1019467,
  website: "familytoyotaofburleson.com",
  name: "Family Toyota Of Burleson",
  street: "2200 E Copeland Rd",
  city: "Arlington",
  state: "TX",
  country: "US",
  zip: "76011",
  latitude: 32.7451,
  longitude: -97.0836,
  msa_code: "2800",
  phone: "817-555-0142",
  seller_email: "sales@familytoyotaofburleson.com",
  dealer_type: "franchise",
};

/** The sibling object. `dealer.id` equals `mc_website_id`; every other id is distinct. */
const FULL_MC_DEALERSHIP = {
  mc_website_id: 1019467,
  mc_dealer_id: 1111229,
  mc_location_id: 1392931,
  mc_rooftop_id: 573299,
  mc_category: "Dealer",
  website: "familytoyotaofburleson.com",
  name: "Family Toyota Of Burleson",
  dealer_type: "franchise",
  street: "2200 E Copeland Rd",
  city: "Arlington",
  state: "TX",
  zip: "76011",
  latitude: 32.7451,
  longitude: -97.0836,
  phone: "817-555-0142",
};

const LISTING = {
  id: "1FTFW1ET5DFC10312-e02d9c1d-b345",
  vin: "1FTFW1ET5DFC10312",
  build: { year: 2022, make: "Ford", model: "F-150", trim: "XLT" },
  miles: 41_200,
  price: 38_995,
  dist: 27.3,
  dos_active: 14,
  last_seen_at_date: "2026-09-08T03:17:49.000Z",
  dealer: FULL_DEALER,
  mc_dealership: FULL_MC_DEALERSHIP,
  // Returned unrequested on every live listing, and never to be read. MarketCheck's own
  // tool contract: "Carfax data on this server is incomplete and unreliable ... Treat all
  // Carfax fields as if they did not exist." §8a makes the vehicle history report
  // dealer-supplied. The guard that keeps this true is
  // lib/services/inventory/__tests__/no-carfax-from-provider.test.ts.
  carfax_1_owner: true,
  carfax_clean_title: false,
};

describe("every field of the dealer object survives normalization", () => {
  const cases: Array<[string, unknown]> = [
    ["externalDealerName", "Family Toyota Of Burleson"],
    ["externalDealerStreet", "2200 E Copeland Rd"],
    ["externalDealerCity", "Arlington"],
    ["externalDealerState", "TX"],
    ["externalDealerZip", "76011"],
    ["externalDealerPhone", "817-555-0142"],
    ["externalDealerEmail", "sales@familytoyotaofburleson.com"],
    ["externalDealerType", "franchise"],
    // The rooftop graph's strongest key. `dealer_rooftops.website_host` is @unique and
    // the table has no phone or email column, so this is the join key — and it was not
    // even declared on the listing type before Phase 4.
    ["externalDealerWebsite", "familytoyotaofburleson.com"],
    // From `mc_dealership`, never from `dealer`.
    ["mcRooftopId", "573299"],
    ["mcDealerId", "1111229"],
    ["mcLocationId", "1392931"],
    ["mcWebsiteId", "1019467"],
    ["mcCategory", "Dealer"],
    ["listingId", "1FTFW1ET5DFC10312-e02d9c1d-b345"],
    ["daysOnLot", 14],
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

// ── The identifier spaces, kept apart ──────────────────────────────────────
//
// The retired behaviour was `mcDealerId: dealer.mc_dealer_id ?? dealer.id`, whose comment
// called the fallback "the strongest join key we have rather than none". It is not a
// weaker version of the same key — `dealer.id` IS `mc_website_id`, a different space, so
// the fallback wrote a website id into a dealer-id column. Every row ingested before
// Phase 4 carries that. Nothing is lost by removing it: `mcWebsiteId` now captures
// `dealer.id` under its real name.

test("mcDealerId comes from mc_dealership and does NOT fall back to dealer.id", () => {
  const v = normalize({ ...LISTING, mc_dealership: { ...FULL_MC_DEALERSHIP, mc_dealer_id: undefined } })!;
  assert.equal(v.mcDealerId, undefined,
    "dealer.id is the WEBSITE id — storing it as the dealer id is the defect, not a fallback");
  assert.equal(v.mcWebsiteId, "1019467", "and it is still captured, under its real name");
});

test("mcWebsiteId falls back to dealer.id, because they are the same identifier", () => {
  // Verified on 3/3 live listings: dealer.id === mc_dealership.mc_website_id.
  const v = normalize({ ...LISTING, mc_dealership: { ...FULL_MC_DEALERSHIP, mc_website_id: undefined } })!;
  assert.equal(v.mcWebsiteId, "1019467", "coerced to string — the column is TEXT");
});

test("identifiers are absent, not invented, when mc_dealership is missing", () => {
  const v = normalize({ ...LISTING, mc_dealership: undefined })!;
  assert.equal(v.mcRooftopId, undefined, "there is no other source for the rooftop id");
  assert.equal(v.mcDealerId, undefined);
  assert.equal(v.mcCategory, undefined);
  assert.equal(v.mcWebsiteId, "1019467", "dealer.id still supplies this one");
  assert.equal(v.externalDealerName, "Family Toyota Of Burleson", "the dealer object is untouched by this");
});

test("mc_dealership alone is enough — dealer may be absent", () => {
  // Both flags are sent together, but the objects are independent and the read must not
  // assume they arrive as a pair.
  const v = normalize({ ...LISTING, dealer: undefined })!;
  assert.equal(v.mcRooftopId, "573299");
  assert.equal(v.externalDealerName, "Family Toyota Of Burleson", "mc_dealership carries a name too");
  assert.equal(v.externalDealerWebsite, "familytoyotaofburleson.com");
  assert.equal(v.latitude, 32.7451, "and coordinates");
});

test("a listing with NEITHER object still normalizes; provenance is simply absent", () => {
  const v = normalize({ ...LISTING, dealer: undefined, mc_dealership: undefined });
  assert.ok(v, "a missing dealer must never drop the vehicle");
  assert.equal(v!.externalDealerName, undefined);
  assert.equal(v!.latitude, undefined);
  assert.equal(v!.mcDealerId, undefined);
  assert.equal(v!.mcRooftopId, undefined);
});

test("provider freshness is read from the listing, distinct from our own lastSeenAt", () => {
  const v = normalize(LISTING)!;
  assert.deepEqual(v.providerLastSeenAt, new Date("2026-09-08T03:17:49.000Z"),
    "when the PROVIDER last saw it — the 7/30-day buyer clocks read this, not our sweep clock");
});

test("a partial dealer object keeps what it has and omits the rest", () => {
  const v = normalize({
    ...LISTING,
    dealer: { name: "Sparse Motors", state: "TX" },
    mc_dealership: undefined,
  })!;
  assert.equal(v.externalDealerName, "Sparse Motors");
  assert.equal(v.state, "TX");
  assert.equal(v.zip, undefined);
  assert.equal(v.latitude, undefined);
});

test("non-numeric coordinates are dropped rather than stored as NaN", () => {
  const v = normalize({
    ...LISTING,
    dealer: { ...FULL_DEALER, latitude: "not-a-number", longitude: null },
    mc_dealership: { ...FULL_MC_DEALERSHIP, latitude: "not-a-number", longitude: null },
  })!;
  assert.equal(v.latitude, undefined, "NaN in a Decimal column is a write error, not a location");
  assert.equal(v.longitude, undefined);
});

test("out-of-range coordinates are rejected — they are provider noise, not places", () => {
  const v = normalize({ ...LISTING, dealer: { ...FULL_DEALER, latitude: 991, longitude: -7000 },
    mc_dealership: { ...FULL_MC_DEALERSHIP, latitude: 991, longitude: -7000 } })!;
  assert.equal(v.latitude, undefined);
  assert.equal(v.longitude, undefined);
});

test("0,0 is rejected — Null Island is the provider's missing-coordinate sentinel", () => {
  const v = normalize({ ...LISTING, dealer: { ...FULL_DEALER, latitude: 0, longitude: 0 },
    mc_dealership: { ...FULL_MC_DEALERSHIP, latitude: 0, longitude: 0 } })!;
  assert.equal(v.latitude, undefined);
  assert.equal(v.longitude, undefined);
});

test("blank strings are omitted, never written as empty columns", () => {
  // Blank in BOTH objects. `text()` treats "" and "   " as absent, and nothing downstream
  // may see an empty string in a nullable column.
  const v = normalize({
    ...LISTING,
    dealer: { ...FULL_DEALER, seller_email: "   ", street: "", dealer_type: "", website: "  " },
    mc_dealership: { ...FULL_MC_DEALERSHIP, street: "", dealer_type: "", website: "  " },
  })!;
  assert.equal(v.externalDealerEmail, undefined);
  assert.equal(v.externalDealerStreet, undefined);
  assert.equal(v.externalDealerType, undefined);
  assert.equal(v.externalDealerWebsite, undefined);
});

test("a field blank in one object is taken from the sibling, not written blank", () => {
  // The merge is why the test above had to blank both. Providers are inconsistent about
  // WHICH object carries a value, and the two describe the same rooftop — so a blank in
  // `dealer` falling back to a populated `mc_dealership` is the correct outcome, and
  // strictly better than storing nothing. This is the case that used to be impossible,
  // because only one object was ever read.
  const v = normalize({
    ...LISTING,
    dealer: { ...FULL_DEALER, street: "", website: "   ", city: "" },
  })!;
  assert.equal(v.externalDealerStreet, "2200 E Copeland Rd");
  assert.equal(v.externalDealerWebsite, "familytoyotaofburleson.com");
  assert.equal(v.externalDealerCity, "Arlington");
  assert.equal(v.city, "Arlington", "the item's own geography follows the same merge");
});

test("seller_email comes only from `dealer` — mc_dealership does not carry one", () => {
  // Not a merge oversight: the mc_dealership object has no email field at all. Recorded so
  // a future reader does not "fix" it by inventing a fallback that has no source.
  const v = normalize({ ...LISTING, dealer: undefined })!;
  assert.equal(v.externalDealerEmail, undefined);
  assert.equal(v.externalDealerName, "Family Toyota Of Burleson", "everything else still resolves");
});

test("normalization still rejects a vehicle with no price — unchanged contract", () => {
  assert.equal(normalize({ ...LISTING, price: 0 }), null);
  assert.equal(normalize({ ...LISTING, build: { year: 2022, make: "Ford" } }), null);
});
