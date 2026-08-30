// Filter-state regression suite for the Content worktable.
//
// Two defects this pins:
//
//  1. STALE CONFIRMATION COUNT. "Publish All N" set a new filter and opened the
//     irreversible-action dialog in the same tick, while the count still held
//     the PREVIOUS filter's total. The dialog could read "Publish 1,204
//     articles" when the real target was 38. `filterSignature` lets the client
//     tell whether a total still corresponds to the active filter, so the
//     dialog can refuse to render a number it cannot vouch for.
//
//  2. FILTER DRIFT BETWEEN LIST AND BULK. "Select all matching" sends a FILTER,
//     not ids. If a filter narrows the visible list but is dropped from the
//     bulk payload, the operator confirms against what they can see and the
//     server acts on a wider set. The round-trip test below is the guard.
//
// Run with:  npx tsx --test components/admin/content/__tests__/content-filters.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_FILTERS,
  type ContentFilterState,
  filterSignature,
  fromSearchParams,
  isBulkFilterable,
  qualityRange,
  toBulkFilter,
  toQueryParams,
  toSearchParams,
} from "../content-filters";

/** Every field that narrows the matching set, with a representative value. */
const NARROWING_FIELDS: Array<[keyof ContentFilterState, string]> = [
  ["status", "REVIEW_NEEDED"],
  ["cluster", "dealer_quotes"],
  ["metro", "Dallas-Fort Worth"],
  ["quality", "le4"],
  ["search", "camry"],
  ["scheduled", "1"],
  ["failed", "1"],
];

describe("filterSignature — does the current total still describe the current filter?", () => {
  test("an unchanged filter keeps its signature", () => {
    assert.equal(filterSignature(EMPTY_FILTERS), filterSignature({ ...EMPTY_FILTERS }));
  });

  test("every narrowing field changes the signature", () => {
    const base = filterSignature(EMPTY_FILTERS);
    for (const [field, value] of NARROWING_FIELDS) {
      const next = filterSignature({ ...EMPTY_FILTERS, [field]: value });
      assert.notEqual(next, base, `${String(field)} must invalidate a cached total`);
    }
  });

  test("sort does NOT change the signature — it reorders, it does not re-match", () => {
    const base = filterSignature(EMPTY_FILTERS);
    assert.equal(filterSignature({ ...EMPTY_FILTERS, sort: "quality_asc" }), base);
    assert.equal(filterSignature({ ...EMPTY_FILTERS, sort: "title_asc" }), base);
  });

  test("the review-queue filter has a different signature from the default view", () => {
    // The exact transition behind the stale-count bug.
    const before = filterSignature(EMPTY_FILTERS);
    const after = filterSignature({ ...EMPTY_FILTERS, status: "REVIEW_NEEDED" });
    assert.notEqual(after, before, "the dialog must detect that its total is stale");
  });
});

describe("toBulkFilter — the visible list and the bulk target must agree", () => {
  test("every narrowing field either reaches the bulk payload or disqualifies select-all", () => {
    // The invariant that actually matters. A field that narrows the visible
    // list has exactly two honest fates: the server can express it as a bulk
    // predicate, or it cannot — in which case select-all-matching must be
    // withheld so the operator selects explicit ids instead. What must never
    // happen is the third case: the field narrows the list, is dropped from the
    // payload, and the bulk action quietly hits a wider set.
    for (const [field, value] of NARROWING_FIELDS) {
      const filters = { ...EMPTY_FILTERS, [field]: value };
      const reachesServer = Object.keys(toBulkFilter(filters)).length > 0;
      const withheld = !isBulkFilterable(filters);
      assert.ok(
        reachesServer || withheld,
        `${String(field)} narrows the list, is absent from the bulk payload, and still ` +
          `permits "select all matching" — the action would hit more rows than were shown`,
      );
    }
  });

  test("a free-text search withholds select-all-matching rather than being dropped", () => {
    assert.equal(isBulkFilterable({ ...EMPTY_FILTERS, search: "camry" }), false);
    assert.equal(isBulkFilterable(EMPTY_FILTERS), true);
    assert.equal(isBulkFilterable({ ...EMPTY_FILTERS, status: "DRAFT" }), true);
  });

  test("quality bands map to the numeric range the server understands", () => {
    assert.deepEqual(toBulkFilter({ ...EMPTY_FILTERS, quality: "6" }), {
      quality_score_min: 6,
      quality_score_max: 6,
    });
    assert.deepEqual(toBulkFilter({ ...EMPTY_FILTERS, quality: "le4" }), {
      quality_score_max: 4,
    });
  });

  test("the scheduled and failed lenses reach the bulk payload", () => {
    assert.deepEqual(toBulkFilter({ ...EMPTY_FILTERS, scheduled: "1" }), { scheduled: "1" });
    assert.deepEqual(toBulkFilter({ ...EMPTY_FILTERS, failed: "1" }), { failed: "1" });
  });

  test("an empty filter produces an empty payload — meaning 'everything', deliberately", () => {
    assert.deepEqual(toBulkFilter(EMPTY_FILTERS), {});
  });

  test("sort is never sent as a bulk filter — it is not a predicate", () => {
    const bulk = toBulkFilter({ ...EMPTY_FILTERS, sort: "quality_asc" });
    assert.ok(!("sort" in bulk));
  });

  test("search is not sent as a bulk filter", () => {
    // The bulk endpoint's filter schema has no free-text predicate. Sending one
    // would be silently dropped server-side and widen the target set, so the
    // worktable must fall back to explicit ids when a search is active.
    const bulk = toBulkFilter({ ...EMPTY_FILTERS, search: "camry" });
    assert.ok(!("search" in bulk), "search must not masquerade as a server-side bulk predicate");
  });
});

describe("query params — what the list endpoint receives", () => {
  test("carries every active filter plus paging", () => {
    const p = toQueryParams(
      { ...EMPTY_FILTERS, status: "DRAFT", cluster: "leasing", search: "tacoma", sort: "oldest" },
      { page: "2", limit: "50" },
    );
    assert.equal(p.get("status"), "DRAFT");
    assert.equal(p.get("cluster"), "leasing");
    assert.equal(p.get("search"), "tacoma");
    assert.equal(p.get("sort"), "oldest");
    assert.equal(p.get("page"), "2");
    assert.equal(p.get("limit"), "50");
  });

  test("omits empty filters instead of sending blanks", () => {
    const p = toQueryParams(EMPTY_FILTERS, {});
    assert.equal(p.get("status"), null);
    assert.equal(p.get("cluster"), null);
    assert.equal(p.get("search"), null);
  });

  test("quality bands expand into min/max", () => {
    const p = toQueryParams({ ...EMPTY_FILTERS, quality: "5" }, {});
    assert.equal(p.get("quality_score_min"), "5");
    assert.equal(p.get("quality_score_max"), "5");
  });
});

describe("URL round-trip — filters stay shareable and Back-button safe", () => {
  test("a full filter survives a round trip through the URL", () => {
    const filters: ContentFilterState = {
      status: "PUBLISHED",
      cluster: "otd_price",
      metro: "Phoenix",
      quality: "6",
      search: "highlander",
      sort: "quality_desc",
      scheduled: "",
      failed: "",
    };
    const restored = fromSearchParams(new URLSearchParams(toSearchParams(filters).toString()));
    assert.deepEqual(restored, filters);
  });

  test("an empty filter produces a clean URL", () => {
    assert.equal(toSearchParams(EMPTY_FILTERS).toString(), "");
  });

  test("unknown or malformed params fall back to the empty filter", () => {
    const restored = fromSearchParams(new URLSearchParams("nonsense=1&status=&sort="));
    assert.deepEqual(restored, EMPTY_FILTERS);
  });

  test("the scheduled and failed lenses round-trip", () => {
    const restored = fromSearchParams(new URLSearchParams("failed=1"));
    assert.equal(restored.failed, "1");
    assert.equal(restored.scheduled, "");
  });
});

describe("qualityRange", () => {
  test("maps each band, and treats an unset band as unbounded", () => {
    assert.deepEqual(qualityRange("6"), { min: 6, max: 6 });
    assert.deepEqual(qualityRange("5"), { min: 5, max: 5 });
    assert.deepEqual(qualityRange("le4"), { min: undefined, max: 4 });
    assert.deepEqual(qualityRange(""), { min: undefined, max: undefined });
    assert.deepEqual(qualityRange("garbage"), { min: undefined, max: undefined });
  });
});
