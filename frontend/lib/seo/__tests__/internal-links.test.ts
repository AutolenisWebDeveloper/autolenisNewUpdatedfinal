// Unit tests for the Phase C4 internal-linking ranker.
// Run with:  npx tsx --test lib/seo/__tests__/internal-links.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  rankRelatedArticles,
  relationLabel,
  type RelatedArticleCandidate,
} from "../internal-links";

function cand(partial: Partial<RelatedArticleCandidate> & { slug: string }): RelatedArticleCandidate {
  return {
    title: partial.slug,
    h1: partial.slug,
    cluster: "dealer_quotes",
    make: null,
    model: null,
    city: "Dallas",
    state: "TX",
    metro: "Dallas-Fort Worth",
    ...partial,
  };
}

const current = cand({
  slug: "toyota-rav4-dealer-quotes-dallas-tx",
  cluster: "dealer_quotes",
  make: "Toyota",
  model: "RAV4",
  city: "Dallas",
  state: "TX",
  metro: "Dallas-Fort Worth",
});

test("excludes the current article", () => {
  const links = rankRelatedArticles(current, [current]);
  assert.equal(links.length, 0);
});

test("ranks same-vehicle-other-city above unrelated same-cluster", () => {
  const sameVehicleOtherCity = cand({
    slug: "toyota-rav4-dealer-quotes-houston-tx",
    make: "Toyota",
    model: "RAV4",
    city: "Houston",
    state: "TX",
    metro: "Houston",
  });
  const unrelated = cand({
    slug: "ford-f150-dealer-quotes-miami-fl",
    make: "Ford",
    model: "F-150",
    city: "Miami",
    state: "FL",
    metro: "Miami",
  });

  const links = rankRelatedArticles(current, [unrelated, sameVehicleOtherCity]);
  assert.equal(links[0].slug, sameVehicleOtherCity.slug);
  assert.equal(links[0].reason, "same_vehicle_other_city");
});

test("same city + different topic surfaces with the right reason", () => {
  const sameCityOtherTopic = cand({
    slug: "trade-in-value-dallas-tx",
    cluster: "trade_in",
    make: null,
    model: null,
    city: "Dallas",
    state: "TX",
  });
  const links = rankRelatedArticles(current, [sameCityOtherTopic]);
  assert.equal(links[0].slug, sameCityOtherTopic.slug);
  assert.equal(links[0].reason, "same_city_other_topic");
});

test("drops zero-score candidates (nothing in common)", () => {
  const unrelated = cand({
    slug: "car-lease-deals-seattle-wa",
    cluster: "leasing",
    make: null,
    model: null,
    city: "Seattle",
    state: "WA",
    metro: "Seattle",
  });
  const links = rankRelatedArticles(current, [unrelated]);
  assert.equal(links.length, 0);
});

test("respects the limit and is deterministic", () => {
  const pool = Array.from({ length: 20 }, (_, i) =>
    cand({
      slug: `toyota-rav4-dealer-quotes-city${i}-tx`,
      make: "Toyota",
      model: "RAV4",
      city: `City${i}`,
      state: "TX",
      metro: `Metro${i}`,
    }),
  );
  const a = rankRelatedArticles(current, pool, 6);
  const b = rankRelatedArticles(current, [...pool].reverse(), 6);
  assert.equal(a.length, 6);
  assert.deepEqual(
    a.map((l) => l.slug),
    b.map((l) => l.slug),
    "ranking must not depend on input order",
  );
});

test("variety cap limits same-cluster links when alternatives exist", () => {
  const sameClusterPool = Array.from({ length: 10 }, (_, i) =>
    cand({
      slug: `toyota-rav4-dealer-quotes-city${i}-tx`,
      cluster: "dealer_quotes",
      make: "Toyota",
      model: "RAV4",
      city: `City${i}`,
      state: "TX",
      metro: `Metro${i}`,
    }),
  );
  const otherClusterPool = Array.from({ length: 10 }, (_, i) =>
    cand({
      slug: `trade-in-value-dallas-tx-${i}`,
      cluster: "trade_in",
      make: null,
      model: null,
      city: "Dallas",
      state: "TX",
    }),
  );
  const links = rankRelatedArticles(current, [...sameClusterPool, ...otherClusterPool], 6);
  const sameCluster = links.filter((l) => l.cluster === "dealer_quotes");
  assert.ok(sameCluster.length <= 3, "no more than half should share the cluster");
  assert.equal(links.length, 6);
});

test("relationLabel maps reasons to human copy", () => {
  assert.equal(relationLabel("same_vehicle_other_city"), "Same vehicle, another city");
  assert.equal(relationLabel("same_city_other_topic"), "More for your city");
  assert.equal(relationLabel("same_topic_nearby"), "Nearby city");
  assert.equal(relationLabel("related"), "Related guide");
});
