// Task 3 — resolve an Apollo organization to a dealer_rooftops row.
//
// Matching REUSES dealerIdentityKeys() from dealer-identity.service, the same
// function that produced the name_key / name_zip_key / name_city_state_key /
// website_host / phone_key columns already stored on dealer_rooftops. A second
// normalizer would compute keys that do not agree with the persisted ones, so
// the match would silently degrade as the two drifted.
//
// The governing rule is "never silently guess". Every link records HOW it was
// made and how confident that is, and an ambiguous match is recorded as low
// confidence rather than taken on trust — it is still a lead, but a reviewer can
// find it. Enrichment spends real credits against whatever rooftop is chosen
// here, so a wrong link is a wrong charge.

import test from "node:test";
import assert from "node:assert/strict";

import {
  matchApolloOrgToRooftop,
  MATCH_METHOD_CONFIDENCE,
  type ApolloOrgInput,
  type OrgMatchDeps,
  type RooftopRow,
} from "../apollo-org-match.service";

const ORG: ApolloOrgInput = {
  name: "Round Rock Toyota",
  domain: null,
  city: "Austin",
  state: "TX",
  zip: "78701",
  phone: null,
};

function rooftop(id: string, over: Partial<RooftopRow> = {}): RooftopRow {
  return {
    id,
    displayName: "Round Rock Toyota",
    websiteHost: null,
    nameZipKey: null,
    nameCityStateKey: null,
    phoneKey: null,
    ...over,
  };
}

interface Harness {
  deps: Partial<OrgMatchDeps>;
  created: () => unknown[];
}

function harness(rooftops: RooftopRow[]): Harness {
  const created: unknown[] = [];
  return {
    created: () => created,
    deps: {
      findRooftops: async () => rooftops,
      createRooftop: async (input) => {
        created.push(input);
        return { id: `new_${created.length}` };
      },
    },
  };
}

test("website_host is the strongest key and beats a weaker name match", async () => {
  const h = harness([
    rooftop("rt_host", { websiteHost: "roundrocktoyota.com" }),
    rooftop("rt_name", { nameCityStateKey: "round rock toyota|austin|tx" }),
  ]);
  const r = await matchApolloOrgToRooftop(
    { ...ORG, domain: "https://www.roundrocktoyota.com/inventory" },
    h.deps,
  );
  assert.equal(r.rooftopId, "rt_host");
  assert.equal(r.method, "website_host");
  assert.equal(r.confidence, "high");
  assert.equal(r.created, false);
});

test("name+zip is preferred over name+city+state", async () => {
  const h = harness([
    rooftop("rt_zip", { nameZipKey: "round rock toyota|78701" }),
    rooftop("rt_city", { nameCityStateKey: "round rock toyota|austin|tx" }),
  ]);
  const r = await matchApolloOrgToRooftop(ORG, h.deps);
  assert.equal(r.rooftopId, "rt_zip");
  assert.equal(r.method, "name_zip");
});

test("name+city+state matches at medium confidence", async () => {
  const h = harness([rooftop("rt_city", { nameCityStateKey: "round rock toyota|austin|tx" })]);
  const r = await matchApolloOrgToRooftop(ORG, h.deps);
  assert.equal(r.rooftopId, "rt_city");
  assert.equal(r.method, "name_city_state");
  assert.equal(r.confidence, "medium");
});

test("phone is the last resort, below every name key", async () => {
  const h = harness([rooftop("rt_phone", { phoneKey: "+15125551212" })]);
  const r = await matchApolloOrgToRooftop({ ...ORG, phone: "(512) 555-1212" }, h.deps);
  assert.equal(r.rooftopId, "rt_phone");
  assert.equal(r.method, "phone");
});

test("a legal suffix does not prevent a match — the shared normalizer strips it", async () => {
  // dealer_rooftops stores keys built by normalizeDealerName, which drops LLC /
  // Inc. Apollo returns the legal name far more often than the trading name, so
  // reusing that normalizer is what makes these agree at all.
  const h = harness([rooftop("rt", { nameZipKey: "round rock toyota|78701" })]);
  const r = await matchApolloOrgToRooftop({ ...ORG, name: "Round Rock Toyota, LLC" }, h.deps);
  assert.equal(r.rooftopId, "rt");
});

test("an unmatched org CREATES a rooftop rather than dropping the person", async () => {
  const h = harness([]);
  const r = await matchApolloOrgToRooftop(
    { name: "Brand New Motors", domain: null, city: "Plano", state: "TX", zip: "75024", phone: null },
    h.deps,
  );
  assert.equal(r.created, true);
  assert.equal(r.method, "created");
  assert.equal(r.rooftopId, "new_1");
  assert.equal(h.created().length, 1);
});

test("a created rooftop carries the keys, so the NEXT org matches it", async () => {
  const h = harness([]);
  await matchApolloOrgToRooftop(ORG, h.deps);
  const c = h.created()[0] as Record<string, unknown>;
  assert.equal(c.nameZipKey, "round rock toyota|78701");
  assert.equal(c.nameCityStateKey, "round rock toyota|austin|tx");
  assert.equal(c.displayName, "Round Rock Toyota");
});

test("an ambiguous name+city+state is LOW confidence, deterministic, and never silent", async () => {
  // Two rooftops share the key. Picking one is unavoidable — the alternative is
  // dropping a real lead — but it is recorded as low confidence so a reviewer can
  // find every link that was a coin flip.
  const h = harness([
    rooftop("rt_b", { nameCityStateKey: "round rock toyota|austin|tx" }),
    rooftop("rt_a", { nameCityStateKey: "round rock toyota|austin|tx" }),
  ]);
  const r = await matchApolloOrgToRooftop(ORG, h.deps);
  assert.equal(r.confidence, "low");
  assert.equal(r.ambiguous, true);
  assert.equal(r.candidateCount, 2);
  assert.equal(r.rooftopId, "rt_a", "ties break on lowest id so a re-run is stable");
});

test("an org with no usable key at all is reported, not guessed", async () => {
  const h = harness([rooftop("rt", { nameCityStateKey: "round rock toyota|austin|tx" })]);
  const r = await matchApolloOrgToRooftop(
    { name: null, domain: null, city: null, state: null, zip: null, phone: null },
    h.deps,
  );
  assert.equal(r.rooftopId, null);
  assert.equal(r.method, "unmatchable");
  assert.equal(r.created, false);
  assert.equal(h.created().length, 0, "a nameless org must not create a junk rooftop");
});

test("every outcome carries a method and a confidence — no silent links", async () => {
  const cases: Array<[string, RooftopRow[], ApolloOrgInput]> = [
    ["host", [rooftop("a", { websiteHost: "x.com" })], { ...ORG, domain: "x.com" }],
    ["zip", [rooftop("b", { nameZipKey: "round rock toyota|78701" })], ORG],
    ["city", [rooftop("c", { nameCityStateKey: "round rock toyota|austin|tx" })], ORG],
    ["created", [], ORG],
  ];
  for (const [label, rooftops, org] of cases) {
    const r = await matchApolloOrgToRooftop(org, harness(rooftops).deps);
    assert.ok(r.method, `${label}: method must be recorded`);
    assert.ok(r.confidence, `${label}: confidence must be recorded`);
    assert.ok(
      MATCH_METHOD_CONFIDENCE[r.method] !== undefined,
      `${label}: ${r.method} must have a declared confidence`,
    );
  }
});

test("confidence is a property of the METHOD, not decided per call", () => {
  // A per-call judgement would let the same method report differently in two
  // places. The table is the single source of truth; ambiguity demotes it.
  assert.equal(MATCH_METHOD_CONFIDENCE.website_host, "high");
  assert.equal(MATCH_METHOD_CONFIDENCE.name_zip, "high");
  assert.equal(MATCH_METHOD_CONFIDENCE.name_city_state, "medium");
  assert.equal(MATCH_METHOD_CONFIDENCE.phone, "medium");
  assert.equal(MATCH_METHOD_CONFIDENCE.created, "low");
  assert.equal(MATCH_METHOD_CONFIDENCE.unmatchable, "low");
});
