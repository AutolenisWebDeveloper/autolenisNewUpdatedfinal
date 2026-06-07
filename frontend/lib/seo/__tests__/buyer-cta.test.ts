// Unit tests for the Phase C4 state-aware buyer CTA helpers.
// Run with:  npx tsx --test lib/seo/__tests__/buyer-cta.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBuyerUrl,
  buildCtaHeadline,
  buildCtaSubcopy,
  locationLabel,
} from "../buyer-cta";

test("buildBuyerUrl carries full vehicle + locale context", () => {
  assert.equal(
    buildBuyerUrl({ city: "Dallas", state: "TX", make: "Toyota", model: "RAV4" }),
    "/for-buyers?city=Dallas&state=TX&make=Toyota&model=RAV4",
  );
});

test("buildBuyerUrl omits empty fields", () => {
  assert.equal(
    buildBuyerUrl({ city: "Chicago", state: "IL" }),
    "/for-buyers?city=Chicago&state=IL",
  );
  assert.equal(buildBuyerUrl({}), "/for-buyers");
});

test("buildBuyerUrl url-encodes multi-word values", () => {
  const url = buildBuyerUrl({ city: "San Antonio", state: "TX", make: "Ford", model: "F-150" });
  assert.match(url, /city=San\+Antonio/);
  assert.match(url, /model=F-150/);
});

test("buildCtaHeadline is fully specific with vehicle + locale", () => {
  assert.equal(
    buildCtaHeadline({ city: "Dallas", state: "TX", make: "Toyota", model: "RAV4" }),
    "Get Toyota RAV4 dealers in Dallas, TX to compete",
  );
});

test("buildCtaHeadline degrades gracefully without a vehicle", () => {
  assert.equal(
    buildCtaHeadline({ city: "Miami", state: "FL" }),
    "Get dealers in Miami, FL to compete",
  );
});

test("buildCtaHeadline degrades gracefully with nothing", () => {
  assert.equal(buildCtaHeadline({}), "Get local dealers to compete");
});

test("locationLabel handles partial context", () => {
  assert.equal(locationLabel({ city: "Austin", state: "TX" }), "Austin, TX");
  assert.equal(locationLabel({ city: "Austin" }), "Austin");
  assert.equal(locationLabel({}), "");
});

test("buildCtaSubcopy references locale and stays compliant (no $ claims)", () => {
  const copy = buildCtaSubcopy({ city: "Denver", state: "CO" });
  assert.match(copy, /in Denver, CO/);
  assert.match(copy, /48-hour auction/);
  assert.doesNotMatch(copy, /\$\d/);
});
