// Unit tests for the Phase C2 quality rubric scorer.
// Run with:  npx tsx --test lib/content/__tests__/quality.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { scoreArticle, type QualityInput } from "../quality";

// Build a body that satisfies the model-controlled checks: local data point,
// first-hand signal, two pillar links + calculator link, and 700+ words.
function buildGoodBody(): string {
  const filler = "Local dealers in this market price the vehicle differently. ".repeat(80);
  return (
    "<p>In Dallas, TX the typical market for this truck favors buyers who compare " +
    "dealers. Based on market conditions, AutoLenis runs a private 48-hour auction " +
    "where 8 dealers compete for your business.</p>" +
    `<h2>What do Dallas dealers typically charge?</h2><p>${filler}</p>` +
    '<p>Read <a href="/buying-guide/how-to-get-best-car-price">getting the best price</a> ' +
    'and <a href="/buying-guide/how-to-negotiate-car-price">how to negotiate</a>. Check fees ' +
    'with our <a href="/tools/dealer-fee-calculator">dealer fee calculator</a>.</p>'
  );
}

const baseInput = (body: string): QualityInput => ({
  body,
  faqs: [{ question: "Q?", answer: "A direct answer about the Dallas market." }],
  city: "Dallas",
  state: "TX",
  metro: "Dallas-Fort Worth",
  pillarSlugs: ["how-to-get-best-car-price", "how-to-negotiate-car-price"],
  toolUrl: "/tools/dealer-fee-calculator",
});

test("a complete article scores 6/6 and passes all", () => {
  const result = scoreArticle(baseInput(buildGoodBody()));
  assert.equal(result.score, 6);
  assert.equal(result.passedAll, true);
  assert.equal(result.flags.length, 0);
  assert.ok(result.wordCount >= 700);
});

test("named author and conversion checks always pass (route-provided)", () => {
  const result = scoreArticle(baseInput("<p>short</p>"));
  const author = result.checks.find((c) => c.id === "named_author");
  const conv = result.checks.find((c) => c.id === "conversion_element");
  assert.equal(author?.passed, true);
  assert.equal(conv?.passed, true);
});

test("short body fails the word-count check", () => {
  const result = scoreArticle(baseInput("<p>Too short for the rubric.</p>"));
  assert.equal(result.checks.find((c) => c.id === "min_word_count")?.passed, false);
  assert.ok(result.flags.includes("Minimum 700 words"));
});

test("missing pillar links fail the internal-links check", () => {
  const body = buildGoodBody().replace(/\/buying-guide\/how-to-negotiate-car-price/g, "/x");
  const result = scoreArticle(baseInput(body));
  assert.equal(result.checks.find((c) => c.id === "internal_links")?.passed, false);
});

test("missing calculator link fails the internal-links check", () => {
  const body = buildGoodBody().replace(/\/tools\/dealer-fee-calculator/g, "/x");
  const result = scoreArticle(baseInput(body));
  assert.equal(result.checks.find((c) => c.id === "internal_links")?.passed, false);
});

test("no city reference fails the local-data-point check", () => {
  const input = baseInput(buildGoodBody());
  input.city = "Nowhereville";
  const result = scoreArticle(input);
  assert.equal(result.checks.find((c) => c.id === "local_data_point")?.passed, false);
});
