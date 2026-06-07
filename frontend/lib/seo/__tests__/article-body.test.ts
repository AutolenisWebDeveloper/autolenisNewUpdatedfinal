// Unit tests for the Phase C4 mid-page CTA body splitter.
// Run with:  npx tsx --test lib/seo/__tests__/article-body.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { splitBodyForMidCta } from "../article-body";
import { getPrimaryClusterForPillar } from "../pillar-links";

test("does not split when there are no H2 sections", () => {
  const html = "<p>Just one paragraph with no headings at all.</p>";
  const out = splitBodyForMidCta(html);
  assert.equal(out.didSplit, false);
  assert.equal(out.before, html);
  assert.equal(out.after, "");
});

test("does not split a single-section article (only a leading H2)", () => {
  const html = "<h2>Only section</h2><p>Body text follows the single heading.</p>";
  const out = splitBodyForMidCta(html);
  assert.equal(out.didSplit, false);
  assert.equal(out.after, "");
});

test("splits at the H2 nearest the midpoint and is lossless", () => {
  // Three equal-length sections, so the seam closest to the character midpoint
  // is unambiguously the middle heading.
  const html =
    "<h2>S1</h2><p>aaaa</p>" +
    "<h2>S2</h2><p>bbbb</p>" +
    "<h2>S3</h2><p>cccc</p>";
  const out = splitBodyForMidCta(html);
  assert.equal(out.didSplit, true);
  // Reassembling the parts must reproduce the original exactly.
  assert.equal(out.before + out.after, html);
  // The seam should fall on the middle heading, not the first one.
  assert.ok(out.after.startsWith("<h2>S2</h2>"));
  assert.ok(out.before.startsWith("<h2>S1</h2>"));
});

test("never leaves the before-half empty", () => {
  const html = "<h2>A</h2><p>x</p><h2>B</h2><p>y</p>";
  const out = splitBodyForMidCta(html);
  assert.ok(out.before.length > 0);
  assert.ok(out.after.length > 0);
});

test("handles attributes and mixed case on the h2 tag", () => {
  const html =
    '<h2 id="intro">Intro</h2><p>aaaa</p>' +
    '<H2 class="q">Question?</H2><p>bbbb</p>';
  const out = splitBodyForMidCta(html);
  assert.equal(out.didSplit, true);
  assert.equal(out.before + out.after, html);
});

test("empty body is a no-op", () => {
  const out = splitBodyForMidCta("");
  assert.equal(out.didSplit, false);
  assert.equal(out.before, "");
});

test("every pillar maps to a known programmatic cluster", () => {
  const clusters = new Set([
    "dealer_quotes",
    "otd_price",
    "dealer_fees",
    "trade_in",
    "leasing",
  ]);
  for (const slug of [
    "how-to-get-best-car-price",
    "how-to-negotiate-car-price",
    "dealer-fees-complete-guide",
    "lease-vs-buy-car",
    "car-trade-in-value-guide",
    "car-buying-concierge-service",
  ]) {
    const cluster = getPrimaryClusterForPillar(slug);
    assert.ok(cluster, `${slug} should map to a cluster`);
    assert.ok(clusters.has(cluster!), `${slug} maps to a valid cluster`);
  }
});

test("unknown pillar slug returns undefined", () => {
  assert.equal(getPrimaryClusterForPillar("not-a-pillar"), undefined);
});
