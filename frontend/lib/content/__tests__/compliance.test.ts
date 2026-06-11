// Unit tests for the Phase C2 compliance validator.
// Run with:  npx tsx --test lib/content/__tests__/compliance.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { validateCompliance, stripHtml } from "../compliance";

test("clean factual mechanics copy passes", () => {
  const ok =
    "<p>In Dallas, TX, 8 local dealers compete for your best price in a private " +
    "48-hour auction. Doc fees in Texas are capped at $150 by law.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});

test("flags a specific dollar savings claim", () => {
  const bad = "<p>Our buyers save $3,000 off MSRP on average.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "dollar_savings_claim"));
});

test("flags a percentage savings claim", () => {
  const bad = "<p>Save 20% off the sticker price instantly.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "percent_savings_claim"));
});

test("flags a guarantee", () => {
  const bad = "<p>We guarantee the lowest price in town.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "guarantee_claim"));
});

test("flags a beat-any-price promise", () => {
  const bad = "<p>We will beat any price you bring us.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "price_promise_claim"));
});

test("flags a testimonial / star rating", () => {
  const bad = '<p>"I saved big!" — a happy buyer. Rated 5 stars.</p>';
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "testimonial_claim"));
});

test("does NOT flag 'guaranteed asset protection' (GAP insurance)", () => {
  const ok =
    "<p>GAP coverage, formally guaranteed asset protection, covers the gap if " +
    "your car is totaled.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
});

test("does NOT flag a stated fee dollar amount that is not a savings claim", () => {
  const ok = "<p>A typical doc fee in Florida runs $300 to $999.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
});

test("does NOT flag the 'best price' pillar link anchor text", () => {
  const ok =
    '<p>Read <a href="/buying-guide/how-to-get-best-car-price">How to Get the ' +
    "Best Price on Any Car</a> for the full playbook.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
});

test("stripHtml removes tags and collapses whitespace", () => {
  assert.equal(stripHtml("<p>Hello   <strong>world</strong></p>"), "Hello world");
});

// --- WO-6 compliance extensions: buyer-not-dealer + pricing language ---

test("flags copy that frames AutoLenis as a dealer/seller", () => {
  const bad = "<p>We sell quality used cars from our dealership inventory.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "buyer_misrepresentation"));
});

test("flags copy that frames AutoLenis as a lender", () => {
  const bad = "<p>AutoLenis is a lender that finances your next vehicle.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "buyer_misrepresentation"));
});

test("does NOT flag buyer-advocate framing (dealers compete for you)", () => {
  const ok =
    "<p>AutoLenis represents you, the buyer — verified dealers compete for your " +
    "business in a private auction.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
});

test("flags 'refundable deposit' pricing language", () => {
  const bad = "<p>Get started with a fully refundable deposit today.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "pricing_language"));
});

test("flags a $99 deposit framing", () => {
  const bad = "<p>Pay a $99 deposit to enter the auction.</p>";
  const result = validateCompliance(bad);
  assert.equal(result.passed, false);
  assert.ok(result.violations.some((v) => v.rule === "pricing_language"));
});

test("does NOT flag the canonical non-refundable Auction Access Fee language", () => {
  const ok =
    "<p>Start with a one-time, non-refundable $99 Auction Access Fee — it is a " +
    "fee, not a deposit.</p>";
  const result = validateCompliance(ok);
  assert.equal(result.passed, true);
});
