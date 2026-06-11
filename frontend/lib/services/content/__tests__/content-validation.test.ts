// Unit tests for the pure layered validation core (WO-6).
// Run with:  npx tsx --test lib/services/content/__tests__/content-validation.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  runContentValidation,
  bodyFingerprint,
  jaccard,
  type ValidationInput,
} from "@/lib/services/content/content-validation.service";

const longBody = `<p>${"In Dallas, Texas the local market shifts week to week as dealers compete for your business in a private auction window. ".repeat(40)}</p><p>Read <a href="/buying-guide/how-to-get-best-car-price">the pricing guide</a> and try the <a href="/tools/dealer-fee-calculator">dealer fee calculator</a>.</p>`;

function baseInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    slug: "toyota-camry-dealer-quotes-dallas-tx",
    title: "Toyota Camry Dealer Quotes in Dallas, TX — Buyer's Guide",
    metaDescription:
      "How to get competing Toyota Camry dealer quotes in Dallas, Texas without haggling — what to ask for and how the auction works.",
    h1: "Toyota Camry Dealer Quotes in Dallas",
    body: longBody,
    faqJson: JSON.stringify([{ question: "How does it work?", answer: "Dealers compete for you." }]),
    targetKeyword: "dealer quotes",
    cluster: "dealer_quotes",
    city: "Dallas",
    state: "TX",
    featuredImageUrl: null,
    ...overrides,
  };
}

function layer(result: ReturnType<typeof runContentValidation>, id: string) {
  const l = result.layers.find((x) => x.id === id);
  assert.ok(l, `expected a ${id} layer`);
  return l!;
}

test("a clean, well-formed article passes all required layers", () => {
  const r = runContentValidation(baseInput());
  assert.equal(r.passed, true);
  assert.equal(layer(r, "compliance").passed, true);
  assert.equal(layer(r, "html_sanitization").passed, true);
  assert.equal(layer(r, "seo_structure").passed, true);
  assert.equal(layer(r, "word_count").passed, true);
  assert.equal(layer(r, "faq_validity").passed, true);
});

test("script-laced body fails sanitization and is cleaned in sanitizedBody", () => {
  const r = runContentValidation(baseInput({ body: longBody + '<script>alert(1)</script>' }));
  assert.equal(layer(r, "html_sanitization").passed, false);
  assert.ok(!r.sanitizedBody.includes("<script"));
  assert.equal(r.passed, false); // required layer failed
});

test("compliance violation (refundable deposit) blocks", () => {
  const r = runContentValidation(
    baseInput({ body: longBody + "<p>Pay a fully refundable deposit to start.</p>" }),
  );
  assert.equal(layer(r, "compliance").passed, false);
  assert.equal(r.passed, false);
});

test("short body fails word count", () => {
  const r = runContentValidation(baseInput({ body: "<p>Too short.</p>" }));
  assert.equal(layer(r, "word_count").passed, false);
  assert.equal(r.passed, false);
});

test("malformed FAQ JSON fails faq_validity", () => {
  const r = runContentValidation(baseInput({ faqJson: "{not json" }));
  assert.equal(layer(r, "faq_validity").passed, false);
  assert.equal(r.passed, false);
});

test("absent FAQ is allowed", () => {
  const r = runContentValidation(baseInput({ faqJson: null }));
  assert.equal(layer(r, "faq_validity").passed, true);
});

test("missing target keyword fails seo_structure", () => {
  const r = runContentValidation(
    baseInput({ targetKeyword: "nonexistent phrase xyz", title: "Generic title about cars here" }),
  );
  assert.equal(layer(r, "seo_structure").passed, false);
});

test("fact-risk flags unsubstantiated averages for human review (non-blocking)", () => {
  const r = runContentValidation(
    baseInput({ body: longBody + "<p>Buyers typically pay $1,200 less than sticker.</p>" }),
  );
  const fr = layer(r, "fact_risk");
  // Either compliance or fact-risk should surface it; fact-risk forces review.
  assert.ok(fr.passed === false || layer(r, "compliance").passed === false);
  if (!fr.passed) assert.equal(r.requiresHumanReview, true);
});

test("duplicate detection flags near-identical bodies", () => {
  const corpus = [{ slug: "other", fingerprint: bodyFingerprint(longBody) }];
  const r = runContentValidation(baseInput({ slug: "new-one", duplicateCorpus: corpus }));
  assert.equal(layer(r, "duplicate").passed, false);
});

test("jaccard is 1 for identical fingerprints and 0 for disjoint", () => {
  const a = bodyFingerprint("the quick brown fox jumps over the lazy dog again and again");
  assert.equal(jaccard(a, a), 1);
  assert.equal(jaccard(a, ["totally", "different", "set", "of", "tokens", "here"]), 0);
});
