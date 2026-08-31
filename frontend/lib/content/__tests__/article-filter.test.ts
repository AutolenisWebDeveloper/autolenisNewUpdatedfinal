// List-vs-mutation parity for the ContentArticle filter.
//
// "Select all matching" sends a FILTER, not an id list. So the rows the
// operator was looking at and the rows the bulk endpoint rewrites are produced
// by two different entry points — a query string and a JSON payload — and if
// those ever resolve differently the action silently hits a wider or narrower
// set than the list showed. That is not hypothetical: before this module the
// list searched four columns and the bulk endpoint had no free-text predicate
// at all.
//
// Both entry points now normalise into one builder, so they cannot disagree by
// construction. These tests hold that property: every field is driven through
// BOTH paths and the resulting Prisma clauses are deep-compared.
//
// Run with:  npx tsx --test lib/content/__tests__/article-filter.test.ts

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildContentArticleWhere,
  filterFromBulkPayload,
  filterFromSearchParams,
  searchClauses,
} from "../article-filter";

/** The same filter expressed both ways: as a query string and as a JSON payload. */
const CASES: Array<{
  name: string;
  query: string;
  payload: Record<string, unknown>;
}> = [
  { name: "empty", query: "", payload: {} },
  { name: "status", query: "status=REVIEW_NEEDED", payload: { status: "REVIEW_NEEDED" } },
  { name: "cluster", query: "cluster=dealer_quotes", payload: { cluster: "dealer_quotes" } },
  { name: "metro", query: "metro=Phoenix", payload: { metro: "Phoenix" } },
  { name: "search", query: "search=camry", payload: { search: "camry" } },
  {
    name: "quality band",
    query: "quality_score_min=5&quality_score_max=5",
    payload: { quality_score_min: 5, quality_score_max: 5 },
  },
  { name: "quality max only", query: "quality_score_max=4", payload: { quality_score_max: 4 } },
  { name: "scheduled lens", query: "scheduled=1", payload: { scheduled: "1" } },
  { name: "failed lens", query: "failed=1", payload: { failed: "1" } },
  {
    name: "scheduled lens plus an explicit status",
    query: "scheduled=1&status=DRAFT",
    payload: { scheduled: "1", status: "DRAFT" },
  },
  {
    name: "search combined with every other predicate",
    query:
      "status=PUBLISHED&cluster=leasing&metro=Dallas-Fort%20Worth&search=tacoma" +
      "&quality_score_max=4&failed=1",
    payload: {
      status: "PUBLISHED",
      cluster: "leasing",
      metro: "Dallas-Fort Worth",
      search: "tacoma",
      quality_score_max: 4,
      failed: "1",
    },
  },
];

describe("the list and the mutation resolve identical clauses", () => {
  for (const c of CASES) {
    test(c.name, () => {
      const fromQuery = buildContentArticleWhere(
        filterFromSearchParams(new URLSearchParams(c.query)),
      );
      const fromPayload = buildContentArticleWhere(filterFromBulkPayload(c.payload));
      assert.deepEqual(
        fromPayload,
        fromQuery,
        `"${c.name}" resolves differently depending on entry point — the bulk action ` +
          `would touch a different set than the list displayed`,
      );
    });
  }
});

describe("free-text search is a real predicate on both paths", () => {
  test("search reaches the clause from the query string", () => {
    const where = buildContentArticleWhere(
      filterFromSearchParams(new URLSearchParams("search=camry")),
    );
    assert.deepEqual(where.OR, searchClauses("camry"));
  });

  test("search reaches the clause from the bulk payload", () => {
    // The property that lets select-all-matching stay available during a
    // search: the mutation narrows by the same text the list narrowed by.
    const where = buildContentArticleWhere(filterFromBulkPayload({ search: "camry" }));
    assert.deepEqual(where.OR, searchClauses("camry"));
  });

  test("it covers title, slug, target keyword and city", () => {
    const fields = searchClauses("x").map((c) => Object.keys(c)[0]).sort();
    assert.deepEqual(fields, ["city", "slug", "targetKeyword", "title"]);
  });

  test("every clause is case-insensitive contains", () => {
    for (const clause of searchClauses("x")) {
      const predicate = Object.values(clause)[0] as { contains: string; mode: string };
      assert.equal(predicate.contains, "x");
      assert.equal(predicate.mode, "insensitive");
    }
  });

  test("whitespace-only search adds no predicate — it would match everything", () => {
    const where = buildContentArticleWhere({ search: "   " });
    assert.equal(where.OR, undefined);
  });

  test("search is trimmed identically on both paths", () => {
    const q = buildContentArticleWhere(filterFromSearchParams(new URLSearchParams("search=  camry  ")));
    const p = buildContentArticleWhere(filterFromBulkPayload({ search: "  camry  " }));
    assert.deepEqual(p, q);
    assert.deepEqual(q.OR, searchClauses("camry"));
  });
});

describe("clause construction", () => {
  test("an unknown status is ignored rather than passed to Prisma", () => {
    const where = buildContentArticleWhere({ status: "NOT_A_STATUS" });
    assert.equal(where.status, undefined);
  });

  test("the scheduled lens does not overwrite an explicit status", () => {
    const where = buildContentArticleWhere({ scheduled: "1", status: "DRAFT" });
    assert.equal(where.status, "DRAFT", "the caller's status must survive");
    assert.deepEqual(where.AND, [{ status: { in: ["DRAFT", "REVIEW_NEEDED"] } }]);
    assert.deepEqual(where.scheduledAt, { not: null });
  });

  test("search and the scheduled lens compose without clobbering each other", () => {
    const where = buildContentArticleWhere({ search: "camry", scheduled: "1" });
    assert.deepEqual(where.OR, searchClauses("camry"), "OR carries the search");
    assert.deepEqual(where.AND, [{ status: { in: ["DRAFT", "REVIEW_NEEDED"] } }], "AND carries the lens");
  });

  test("an empty filter produces an empty clause — deliberately 'everything'", () => {
    assert.deepEqual(buildContentArticleWhere({}), {});
  });

  test("no AND key is emitted when no lens is active", () => {
    assert.equal(buildContentArticleWhere({ status: "DRAFT" }).AND, undefined);
  });
});
