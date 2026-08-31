// Selection-state regression suite for the Content worktable.
//
// The defect this exists to prevent (Batch: admin content UX):
//
//   With "Select All Matching" active every checkbox rendered as checked, but
//   the toggle handler dropped the all-matching flag and then ADDED the clicked
//   id to an empty id set. So clicking a checked row — which every operator
//   reads as "take this one out of the batch" — silently deselected everything
//   else and selected only that row. The next click was a bulk publish.
//
// The selection model is therefore a pure module with an explicit "all matching
// except these" mode, and these tests pin its semantics.
//
// Run with:  npx tsx --test components/admin/content/__tests__/selection.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_SELECTION,
  clearSelection,
  hasSelection,
  isPageFullySelected,
  isRowSelected,
  selectAllMatching,
  selectedCount,
  toBulkTarget,
  togglePage,
  toggleRow,
} from "../selection";

const PAGE = ["a", "b", "c"];

describe("id mode — explicit per-row selection", () => {
  test("starts empty", () => {
    assert.equal(selectedCount(EMPTY_SELECTION, 500), 0);
    assert.equal(isRowSelected(EMPTY_SELECTION, "a"), false);
    assert.equal(hasSelection(EMPTY_SELECTION, 500), false);
  });

  test("toggling adds then removes a row", () => {
    const one = toggleRow(EMPTY_SELECTION, "a");
    assert.equal(isRowSelected(one, "a"), true);
    assert.equal(selectedCount(one, 500), 1);

    const none = toggleRow(one, "a");
    assert.equal(isRowSelected(none, "a"), false);
    assert.equal(selectedCount(none, 500), 0);
  });

  test("selecting the page selects exactly the page, and toggles back off", () => {
    const page = togglePage(EMPTY_SELECTION, PAGE);
    assert.equal(selectedCount(page, 500), 3);
    assert.equal(isPageFullySelected(page, PAGE), true);

    const off = togglePage(page, PAGE);
    assert.equal(selectedCount(off, 500), 0);
    assert.equal(isPageFullySelected(off, PAGE), false);
  });

  test("an empty page is never 'fully selected' — nothing is selected", () => {
    assert.equal(isPageFullySelected(EMPTY_SELECTION, []), false);
  });
});

describe("all-matching mode — the regression this module exists for", () => {
  test("select-all-matching selects every matching row, not just the loaded page", () => {
    const all = selectAllMatching(EMPTY_SELECTION);
    assert.equal(selectedCount(all, 4812), 4812);
    assert.equal(isRowSelected(all, "anything"), true);
    assert.equal(isRowSelected(all, "some-row-on-page-97"), true);
  });

  test("clicking ONE checked row removes only that row — everything else stays selected", () => {
    // This is the exact interaction that used to collapse a 4,812-row selection
    // down to a single row without telling the operator.
    const all = selectAllMatching(EMPTY_SELECTION);
    const minusB = toggleRow(all, "b");

    assert.equal(isRowSelected(minusB, "b"), false, "the clicked row is deselected");
    assert.equal(isRowSelected(minusB, "a"), true, "other rows stay selected");
    assert.equal(isRowSelected(minusB, "zzz"), true, "rows on other pages stay selected");
    assert.equal(
      selectedCount(minusB, 4812),
      4811,
      "the count drops by exactly one — never collapses to 1",
    );
  });

  test("re-clicking an excluded row puts it back in the batch", () => {
    const all = selectAllMatching(EMPTY_SELECTION);
    const minusB = toggleRow(all, "b");
    const restored = toggleRow(minusB, "b");

    assert.equal(isRowSelected(restored, "b"), true);
    assert.equal(selectedCount(restored, 4812), 4812);
  });

  test("excluding every row on the page leaves the rest of the match selected", () => {
    const all = selectAllMatching(EMPTY_SELECTION);
    const noPage = togglePage(all, PAGE);

    for (const id of PAGE) assert.equal(isRowSelected(noPage, id), false);
    assert.equal(isRowSelected(noPage, "off-page"), true);
    assert.equal(selectedCount(noPage, 4812), 4809);
  });

  test("selecting all matching after picking rows discards the narrower pick", () => {
    const some = togglePage(EMPTY_SELECTION, PAGE);
    const all = selectAllMatching(some);
    assert.equal(selectedCount(all, 4812), 4812, "no leftover ids narrow the batch");
  });

  test("count never goes negative even if exclusions exceed a stale total", () => {
    // `total` is refetched asynchronously; a shrinking result set must not
    // produce a negative count in the confirmation copy.
    let s = selectAllMatching(EMPTY_SELECTION);
    for (const id of ["a", "b", "c", "d", "e"]) s = toggleRow(s, id);
    assert.equal(selectedCount(s, 2), 0);
  });

  test("clearing returns to an empty id selection, not to all-matching", () => {
    const all = selectAllMatching(EMPTY_SELECTION);
    const cleared = clearSelection();
    assert.equal(selectedCount(cleared, 4812), 0);
    assert.equal(isRowSelected(cleared, "a"), false);
  });
});

describe("bulk target — what actually gets sent to the server", () => {
  const filter = { status: "REVIEW_NEEDED" };

  test("id mode sends the explicit id list and no filter", () => {
    const s = togglePage(EMPTY_SELECTION, PAGE);
    const target = toBulkTarget(s, filter);
    assert.deepEqual(target, { ids: ["a", "b", "c"] });
  });

  test("all-matching with no exclusions sends the filter alone", () => {
    const target = toBulkTarget(selectAllMatching(EMPTY_SELECTION), filter);
    assert.deepEqual(target, { filter });
    assert.ok(!("excludeIds" in target), "no empty excludeIds array");
    assert.ok(!("ids" in target), "never an id list — the match can span pages");
  });

  test("all-matching with exclusions sends the filter AND the exclusions", () => {
    const s = toggleRow(selectAllMatching(EMPTY_SELECTION), "b");
    const target = toBulkTarget(s, filter);
    assert.deepEqual(target, { filter, excludeIds: ["b"] });
  });

  test("an empty id selection produces no target at all", () => {
    assert.equal(toBulkTarget(EMPTY_SELECTION, filter), null);
  });

  test("all-matching that excluded everything produces no target", () => {
    // Guard: the server treats a filter with no ids as "every matching row".
    // A selection the operator has emptied must never fall through to that.
    let s = selectAllMatching(EMPTY_SELECTION);
    for (const id of PAGE) s = toggleRow(s, id);
    assert.equal(hasSelection(s, 3), false);
    assert.equal(toBulkTarget(s, filter, 3), null);
  });
});
