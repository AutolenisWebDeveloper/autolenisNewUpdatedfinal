// Task 2 — Apollo People Search, the 0-credit acquisition path.
//
// Why this is the PRIMARY route rather than domain enrichment. The existing paid
// path (apolloResolveAndReveal) resolves an organization from the dealer's
// website host before it can search for a person. Website coverage across the
// prospect table is 133/1,532, so org resolution fails for ~91% of the list
// before a person is ever looked at. People Search keys on SIC code + title +
// location instead, which does not depend on knowing a domain.
//
// The load-bearing property proven here: search NEVER draws a credit. Only
// reveal/enrichment costs, so discovery must be free by construction — a search
// path that could spend would make the credit cap unenforceable at its source.

import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  runPeopleSearch,
  MAX_SEARCH_PAGES,
  type PeopleSearchDeps,
} from "../apollo-people-search.service";
import { DEALER_PERSON_TITLES, DEALER_SIC_CODES, type ApolloSearchPerson } from "../apollo.service";

function person(id: string, over: Partial<ApolloSearchPerson> = {}): ApolloSearchPerson {
  return {
    id,
    firstName: "Dana",
    // Search results carry an obfuscated last name. That is expected at this
    // stage and must not be treated as missing data.
    lastNameObfuscated: "R.",
    title: "General Manager",
    linkedinUrl: null,
    organization: {
      id: `org-${id}`,
      name: `Dealer ${id}`,
      city: "Austin",
      state: "TX",
      zip: "78701",
      domain: null,
    },
    ...over,
  };
}

interface Harness {
  deps: Partial<PeopleSearchDeps>;
  persisted: () => Record<string, unknown>[];
  searchCalls: () => { page: number; perPage: number }[];
  creditDraws: () => number;
}

function harness(opts: {
  pages?: Record<number, ApolloSearchPerson[]>;
  totalPages?: number;
  enabled?: boolean;
  throwOnPage?: number;
}): Harness {
  const pages = opts.pages ?? { 1: [person("a")] };
  const totalPages = opts.totalPages ?? 1;
  const persisted: Record<string, unknown>[] = [];
  const searchCalls: { page: number; perPage: number }[] = [];
  let creditDraws = 0;

  return {
    persisted: () => persisted,
    searchCalls: () => searchCalls,
    creditDraws: () => creditDraws,
    deps: {
      enabled: () => opts.enabled ?? true,
      now: new Date("2026-08-31T00:00:00Z"),
      client: {
        async peopleSearchByCriteria({ page, perPage }) {
          searchCalls.push({ page, perPage });
          if (opts.throwOnPage === page) throw new Error("apollo 500");
          return { people: pages[page] ?? [], totalPages, totalEntries: totalPages * 100 };
        },
      },
      persistCandidate: async (c) => {
        persisted.push(c as unknown as Record<string, unknown>);
      },
      // Present ONLY so a test can prove it is never called. The real service
      // has no credit dependency at all.
      drawCredits: async () => {
        creditDraws += 1;
        return { drawn: true };
      },
    },
  };
}

const BASE = { sicCodes: DEALER_SIC_CODES, titles: DEALER_PERSON_TITLES, personLocations: ["Texas"] };

let h: Harness;
beforeEach(() => {
  h = harness({});
});

test("search never draws a credit — discovery is free by construction", async () => {
  h = harness({ pages: { 1: [person("a"), person("b")] } });
  await runPeopleSearch(BASE, h.deps);
  assert.equal(h.creditDraws(), 0, "People Search must never spend; only reveal costs");
});

test("paginates to totalPages and persists every result", async () => {
  h = harness({ pages: { 1: [person("a"), person("b")], 2: [person("c")] }, totalPages: 2 });
  const r = await runPeopleSearch(BASE, h.deps);
  assert.equal(h.searchCalls().length, 2);
  assert.deepEqual(h.searchCalls().map((c) => c.page), [1, 2]);
  assert.equal(r.persisted, 3);
  assert.equal(h.persisted().length, 3);
});

test("an obfuscated last name is persisted verbatim, not discarded", async () => {
  h = harness({ pages: { 1: [person("a", { lastNameObfuscated: "R." })] } });
  await runPeopleSearch(BASE, h.deps);
  assert.equal(h.persisted()[0].lastNameObfuscated, "R.");
});

test("candidates are persisted UNENRICHED — status stays NEW", async () => {
  await runPeopleSearch(BASE, h.deps);
  assert.equal(h.persisted()[0].enrichmentStatus, "NEW");
});

test("organization city/state/zip are carried through for rooftop matching", async () => {
  await runPeopleSearch(BASE, h.deps);
  const c = h.persisted()[0];
  assert.equal(c.organizationCity, "Austin");
  assert.equal(c.organizationState, "TX");
  assert.equal(c.organizationZip, "78701");
  assert.equal(c.apolloOrganizationId, "org-a");
});

test("every candidate carries the run key, so one search is auditable as a unit", async () => {
  h = harness({ pages: { 1: [person("a"), person("b")] } });
  const r = await runPeopleSearch(BASE, h.deps);
  assert.ok(r.searchRunKey);
  for (const c of h.persisted()) assert.equal(c.searchRunKey, r.searchRunKey);
});

test("the disabled flag returns a skipped result and makes NO request", async () => {
  h = harness({ enabled: false });
  const r = await runPeopleSearch(BASE, h.deps);
  assert.equal(r.skipped, true);
  assert.equal(r.persisted, 0);
  assert.equal(h.searchCalls().length, 0, "a disabled search must not reach Apollo at all");
});

test("pagination stops at the caller's page ceiling even when Apollo reports more", async () => {
  const pages: Record<number, ApolloSearchPerson[]> = {};
  for (let i = 1; i <= 50; i++) pages[i] = [person(`p${i}`)];
  h = harness({ pages, totalPages: 10_000 });
  const r = await runPeopleSearch({ ...BASE, maxPages: 3 }, h.deps);
  assert.equal(h.searchCalls().length, 3);
  assert.equal(r.pagesFetched, 3);
});

test("pagination is bounded by a hard ceiling the caller cannot exceed", async () => {
  const pages: Record<number, ApolloSearchPerson[]> = {};
  for (let i = 1; i <= MAX_SEARCH_PAGES + 50; i++) pages[i] = [person(`p${i}`)];
  h = harness({ pages, totalPages: 10_000 });
  const r = await runPeopleSearch({ ...BASE, maxPages: MAX_SEARCH_PAGES + 50 }, h.deps);
  assert.equal(r.pagesFetched, MAX_SEARCH_PAGES, "an unbounded loop against a paid API is never acceptable");
});

test("an empty page ends pagination early rather than walking to totalPages", async () => {
  h = harness({ pages: { 1: [person("a")], 2: [] }, totalPages: 99 });
  const r = await runPeopleSearch(BASE, h.deps);
  assert.equal(h.searchCalls().length, 2);
  assert.equal(r.persisted, 1);
});

test("a mid-pagination failure keeps what was already persisted and reports the error", async () => {
  h = harness({ pages: { 1: [person("a")], 2: [person("b")] }, totalPages: 3, throwOnPage: 2 });
  const r = await runPeopleSearch(BASE, h.deps);
  assert.equal(r.persisted, 1, "page 1's results are not rolled back by page 2 failing");
  assert.ok(r.error, "the failure must be reported, not swallowed");
  assert.match(r.error ?? "", /apollo 500/);
});

test("a result with no organization is still persisted, with null org fields", async () => {
  h = harness({ pages: { 1: [person("a", { organization: null })] } });
  await runPeopleSearch(BASE, h.deps);
  const c = h.persisted()[0];
  assert.equal(c.apolloOrganizationId, null);
  assert.equal(c.organizationName, null);
  // It is still a real person; dropping it would silently lose a candidate.
  assert.equal(c.apolloPersonId, "a");
});

test("the search criteria use dealership SIC and decision-maker titles", () => {
  assert.deepEqual([...DEALER_SIC_CODES], ["5511"]);
  for (const t of ["dealer principal", "general manager", "used car manager", "internet sales manager"]) {
    assert.ok(
      (DEALER_PERSON_TITLES as readonly string[]).includes(t),
      `${t} must be among the searched decision-maker titles`,
    );
  }
});
