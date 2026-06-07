// Unit tests for the Phase C3 admin content-engine display helpers.
// Run with:  npx tsx --test lib/content/__tests__/cluster-meta.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  ARTICLE_STATUSES,
  CLUSTER_ORDER,
  clusterLabel,
  statusMeta,
} from "../cluster-meta";

test("every keyword cluster has a human label", () => {
  for (const cluster of CLUSTER_ORDER) {
    const label = clusterLabel(cluster);
    assert.ok(label.length > 0);
    assert.notEqual(label, cluster); // mapped, not the raw id
  }
});

test("clusterLabel falls back to the raw id for unknown clusters", () => {
  assert.equal(clusterLabel("mystery_cluster"), "mystery_cluster");
});

test("every article status maps to a label and badge variant", () => {
  for (const status of ARTICLE_STATUSES) {
    const meta = statusMeta(status);
    assert.ok(meta.label.length > 0);
    assert.ok(
      ["green", "amber", "gray", "secondary", "blue"].includes(meta.variant),
    );
  }
});

test("published is green, review is amber", () => {
  assert.equal(statusMeta("PUBLISHED").variant, "green");
  assert.equal(statusMeta("REVIEW_NEEDED").variant, "amber");
});
