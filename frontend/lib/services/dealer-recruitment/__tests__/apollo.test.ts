// Block B / Apollo — adapter 3-stage logic + fail-closed + per-stage credit
// accounting, corrected to Apollo's documented contract.
//
// Injected fake client for the orchestration; the live client is exercised
// with a captured global fetch so the request PATHS and SHAPES are asserted —
// the previous implementation sent an undocumented request to an undocumented
// path, and nothing here caught it because nothing looked at the wire.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "@/lib/logger";
import {
  apolloResolveAndReveal,
  defaultApolloClient,
  defaultApolloSearchClient,
  ORG_RESOLVE_COST_CREDITS,
  PEOPLE_MATCH_COST_CREDITS,
  MAX_CREDITS_PER_ATTEMPT,
  type ApolloClient,
  type ApolloEmptyStage,
} from "../apollo.service";

const ORG = { id: "org1", domain: "toyotaofdallas.com", name: "Toyota of Dallas" };

function client(over: Partial<ApolloClient> = {}): ApolloClient {
  return {
    resolveOrganization: async () => ({ org: ORG, billed: true, resolver: "organizations/enrich" }),
    peopleSearch: async () => [
      { id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: true },
    ],
    peopleMatch: async () => ({ email: "ann@toyotaofdallas.com", name: "Ann", title: "Internet Sales Manager" }),
    ...over,
  };
}
const input = { name: "Toyota of Dallas", website: "https://toyotaofdallas.com", city: "Dallas", state: "TX" };

// ─── orchestration: stages and what each one bills ──────────────────────────

test("no client (no key / disabled) → empty, nothing asked, nothing billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: null });
  assert.deepEqual(r, { kind: "empty", creditsBilled: 0, stage: "disabled" });
});

test("3-stage happy path → revealed, billed for the org resolution AND the match", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal(r.kind === "revealed" && r.email, "ann@toyotaofdallas.com");
  assert.equal(r.creditsBilled, MAX_CREDITS_PER_ATTEMPT);
  assert.equal(MAX_CREDITS_PER_ATTEMPT, ORG_RESOLVE_COST_CREDITS + PEOPLE_MATCH_COST_CREDITS);
});

test("stage-1 clean miss (documented free) → no_org, 0 billed", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ resolveOrganization: async () => ({ org: null, billed: false, resolver: "organizations/enrich" }) }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: 0, stage: "no_org" });
});

test("stage-1 miss that Apollo BILLED (matches returned, none usable) → no_org, 1 billed", async () => {
  // mixed_companies/search charges per request that returns any result. If it
  // returned rows we could not use, the credit is still gone and must be kept.
  const r = await apolloResolveAndReveal(input, {
    client: client({ resolveOrganization: async () => ({ org: null, billed: true, resolver: "mixed_companies/search" }) }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "no_org" });
});

test("stage-1 THROWS (non-2xx / transport) → org_error, billed conservatively", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ resolveOrganization: async () => { throw new Error("HTTP 404 on /organizations/enrich"); } }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "org_error" });
});

test("org found, zero people → no_people, the org credit is billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) });
  assert.deepEqual(r, { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "no_people" });
});

test("org found, people search THROWS → its own stage, the org credit is billed", async () => {
  // Distinct from no_people: the credit before it is spent, and an errored
  // search is worth retrying where a genuine miss is not.
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "people_search_error" });
});

test("reveals the best-title person even when search reports has_email:false (plan masks it)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [{ id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: false }],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: "Ann", title: "ISM" }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "p1@toyotaofdallas.com");
});

test("matched but NO email → empty and billed for BOTH stages (Apollo charged for the match — do not refund)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => ({ email: null }) }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: MAX_CREDITS_PER_ATTEMPT, stage: "match_no_email" });
});

test("people/match returns NO person (clean no match) → only the org credit is billed", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => null }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "no_match" });
});

test("people/match throws → both credits billed (cannot know if charged → conservative)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
  });
  assert.deepEqual(r, { kind: "empty", creditsBilled: MAX_CREDITS_PER_ATTEMPT, stage: "match_error" });
});

test("picks the best-title-ranked person (not Apollo's return order)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [
        { id: "sales", name: "S", title: "Sales", hasEmail: true },
        { id: "ism", name: "I", title: "Internet Sales Manager", hasEmail: true },
      ],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: id, title: id }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "ism@toyotaofdallas.com");
});

test("among equal-title people, the flagged (has_email) one is the tiebreak winner", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({
      peopleSearch: async () => [
        { id: "noflag", name: "N", title: "Sales Manager", hasEmail: false },
        { id: "flagged", name: "F", title: "Sales Manager", hasEmail: true },
      ],
      peopleMatch: async (id) => ({ email: `${id}@toyotaofdallas.com`, name: id, title: id }),
    }),
  });
  assert.equal(r.kind === "revealed" && r.email, "flagged@toyotaofdallas.com");
});

test("the normalized domain, city and state reach stage 1 — the resolver needs all three to choose an endpoint", async () => {
  let seen: Record<string, unknown> = {};
  await apolloResolveAndReveal(input, {
    client: client({
      resolveOrganization: async (i) => {
        seen = i;
        return { org: ORG, billed: true, resolver: "organizations/enrich" };
      },
    }),
  });
  assert.deepEqual(seen, { name: "Toyota of Dallas", domain: "toyotaofdallas.com", city: "Dallas", state: "TX" });
});

// ─── live client: the wire, asserted ────────────────────────────────────────
//
// Each test captures what the client actually sends. These are the assertions
// that were missing while the adapter called an undocumented path for two
// billing cycles.

interface Captured { url: string; method: string; body: unknown; }

function withLiveClient(
  responder: (url: string, init: RequestInit) => { status: number; json: unknown },
  run: (c: ApolloClient & { peopleSearchByCriteria: NonNullable<ReturnType<typeof defaultApolloSearchClient>>["peopleSearchByCriteria"] }, calls: Captured[]) => Promise<void>,
) {
  return async () => {
    const prev = { key: process.env.APOLLO_API_KEY, reveal: process.env.APOLLO_REVEAL_ENABLED, search: process.env.APOLLO_PEOPLE_SEARCH_ENABLED, fetch: globalThis.fetch };
    process.env.APOLLO_API_KEY = "test-key";
    process.env.APOLLO_REVEAL_ENABLED = "true";
    process.env.APOLLO_PEOPLE_SEARCH_ENABLED = "true";
    const calls: Captured[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined });
      const r = responder(url, init);
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json } as unknown as Response;
    }) as unknown as typeof fetch;
    try {
      const c = defaultApolloClient();
      const s = defaultApolloSearchClient();
      assert.ok(c && s, "clients should exist when enabled + key present");
      await run({ ...c!, peopleSearchByCriteria: s!.peopleSearchByCriteria }, calls);
    } finally {
      globalThis.fetch = prev.fetch;
      for (const [k, v] of [["APOLLO_API_KEY", prev.key], ["APOLLO_REVEAL_ENABLED", prev.reveal], ["APOLLO_PEOPLE_SEARCH_ENABLED", prev.search]] as const) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  };
}

test(
  "stage 1 WITH a domain → GET organizations/enrich?domain=…, no body, parses `organization`",
  withLiveClient(
    () => ({ status: 200, json: { organization: { id: "o-berman", name: "Berman CDJR", primary_domain: "bermancdjr.com" } } }),
    async (c, calls) => {
      const r = await c.resolveOrganization({ name: "Berman Chrysler Dodge Jeep Ram", domain: "bermancdjr.com", city: "Chicago", state: "IL" });
      assert.equal(calls.length, 1);
      const u = new URL(calls[0].url);
      assert.equal(u.pathname, "/api/v1/organizations/enrich");
      assert.equal(calls[0].method, "GET");
      assert.equal(u.searchParams.get("domain"), "bermancdjr.com");
      assert.equal([...u.searchParams.keys()].length, 1, "only the parameter Apollo's schema declares is sent");
      assert.equal(calls[0].body, undefined, "a GET carries no body");
      assert.deepEqual(r, { org: { id: "o-berman", domain: "bermancdjr.com", name: "Berman CDJR" }, billed: true, resolver: "organizations/enrich" });
    },
  ),
);

test(
  "stage 1 enrich: a 2xx without `organization` is the documented free miss",
  withLiveClient(
    () => ({ status: 200, json: { organization: null } }),
    async (c) => {
      const r = await c.resolveOrganization({ name: "Nobody Motors", domain: "nobody.invalid" });
      assert.deepEqual(r, { org: null, billed: false, resolver: "organizations/enrich" });
    },
  ),
);

test(
  "stage 1 enrich: a non-2xx THROWS rather than reading as a free miss (a wrong path must be loud)",
  withLiveClient(
    () => ({ status: 404, json: { error: "not found" } }),
    async (c) => {
      await assert.rejects(() => c.resolveOrganization({ name: "X", domain: "x.invalid" }), /HTTP 404/);
    },
  ),
);

test(
  "stage 1 WITHOUT a domain → POST mixed_companies/search by name + \"City, ST\", two-bucket envelope",
  withLiveClient(
    () => ({
      status: 200,
      json: {
        // The team already saved this one: its `id` is an ACCOUNT id and the org
        // id lives in organization_id — reading organizations[0] would miss it.
        accounts: [{ id: "acct-1", organization_id: "o-saved", name: "Round Rock Toyota", domain: "roundrocktoyota.com" }],
        organizations: [{ id: "o-other", name: "Round Rock Honda", primary_domain: "roundrockhonda.com" }],
      },
    }),
    async (c, calls) => {
      const r = await c.resolveOrganization({ name: "Round Rock Toyota", domain: null, city: "Round Rock", state: "TX" });
      assert.equal(new URL(calls[0].url).pathname, "/api/v1/mixed_companies/search");
      assert.equal(calls[0].method, "POST");
      const body = calls[0].body as Record<string, unknown>;
      assert.equal(body.q_organization_name, "Round Rock Toyota");
      assert.deepEqual(body.organization_locations, ["Round Rock, TX"]);
      assert.equal("q_organization_domains" in body, false, "the undocumented parameter name is gone");
      // Name-key match wins over return order, and the ACCOUNT row yields its organization_id.
      assert.deepEqual(r, { org: { id: "o-saved", domain: "roundrocktoyota.com", name: "Round Rock Toyota" }, billed: true, resolver: "mixed_companies/search" });
    },
  ),
);

test(
  "stage 1 search: no name-key match → first candidate; empty buckets → not billed",
  withLiveClient(
    (url, init) => {
      const b = JSON.parse(init.body as string) as { q_organization_name: string };
      if (b.q_organization_name === "Empty") return { status: 200, json: { organizations: [], accounts: [] } };
      return { status: 200, json: { organizations: [{ id: "o-first", name: "Something Else" }, { id: "o-second", name: "Another" }] } };
    },
    async (c) => {
      const first = await c.resolveOrganization({ name: "Unrelated Name", domain: null, city: "Austin", state: "TX" });
      assert.equal(first.org?.id, "o-first");
      assert.equal(first.billed, true);
      const empty = await c.resolveOrganization({ name: "Empty", domain: null });
      assert.deepEqual(empty, { org: null, billed: false, resolver: "mixed_companies/search" });
    },
  ),
);

test(
  "stage 2 → POST mixed_people/api_search by organization_ids, and THROWS on a non-2xx",
  withLiveClient(
    (url) => {
      if (url.includes("boom")) return { status: 500, json: {} };
      return { status: 200, json: { people: [{ id: "p1", name: "Ann", title: "ISM", email_status: "verified" }] } };
    },
    async (c, calls) => {
      const people = await c.peopleSearch({ organizationId: "o1", titles: ["Sales Manager"] });
      assert.equal(new URL(calls[0].url).pathname, "/api/v1/mixed_people/api_search");
      const body = calls[0].body as Record<string, unknown>;
      assert.deepEqual(body.organization_ids, ["o1"]);
      assert.deepEqual(body.person_titles, ["Sales Manager"]);
      assert.equal(body.include_similar_titles, true);
      assert.deepEqual(people, [{ id: "p1", name: "Ann", title: "ISM", hasEmail: true }]);
    },
  ),
);

test(
  "stage 2 error is a THROW, never an empty list — the org credit before it is already spent",
  withLiveClient(
    () => ({ status: 429, json: {} }),
    async (c) => {
      await assert.rejects(() => c.peopleSearch({ organizationId: "o1", titles: ["Sales Manager"] }), /HTTP 429/);
    },
  ),
);

test(
  "discovery (peopleSearchByCriteria) → the same api_search path, and stays fail-closed to an empty page",
  withLiveClient(
    (url) => ({ status: url.includes("never") ? 200 : 503, json: {} }),
    async (c, calls) => {
      const page = await c.peopleSearchByCriteria({ sicCodes: ["5511"], titles: ["general manager"], page: 1, perPage: 100 });
      assert.equal(new URL(calls[0].url).pathname, "/api/v1/mixed_people/api_search");
      assert.deepEqual(page, { people: [], totalPages: 0, totalEntries: 0 }, "a free discovery page degrades, never throws");
    },
  ),
);

test(
  "nothing in the live client reaches the undocumented organizations/lookup path",
  withLiveClient(
    () => ({ status: 200, json: { organization: { id: "o1" }, people: [], person: null } }),
    async (c, calls) => {
      await c.resolveOrganization({ name: "A", domain: "a.test" });
      await c.resolveOrganization({ name: "B", domain: null, city: "C", state: "TX" });
      await c.peopleSearch({ organizationId: "o1", titles: ["x"] });
      await c.peopleMatch("p1");
      const paths = calls.map((k) => new URL(k.url).pathname);
      assert.equal(paths.some((p) => p.includes("organizations/lookup")), false);
      assert.equal(paths.some((p) => p.endsWith("/mixed_people/search")), false, "the pre-correction people path is gone too");
    },
  ),
);

test("live client people/match sends deterministic-cost params and NO waterfall keys", async () => {
  const prevKey = process.env.APOLLO_API_KEY;
  const prevEnabled = process.env.APOLLO_REVEAL_ENABLED;
  const prevFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  let sentBody: Record<string, unknown> = {};
  globalThis.fetch = (async (_url: string, init: { body: string }) => {
    sentBody = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ person: { email: "x@y.com" } }) } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const c = defaultApolloClient();
    assert.ok(c, "client should exist when enabled + key present");
    await c!.peopleMatch("person-1");
    assert.equal(sentBody.id, "person-1");
    assert.equal(sentBody.reveal_personal_emails, false);
    assert.equal(sentBody.reveal_phone_number, false); // never trigger the 8-credit phone reveal
    assert.equal("waterfall" in sentBody, false);
    assert.equal(Object.keys(sentBody).some((k) => k.toLowerCase().includes("waterfall")), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});

test("live client people/match THROWS on an HTTP error (billable-call error must not collapse to null)", async () => {
  const prevKey = process.env.APOLLO_API_KEY;
  const prevEnabled = process.env.APOLLO_REVEAL_ENABLED;
  const prevFetch = globalThis.fetch;
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(() => defaultApolloClient()!.peopleMatch("p1"), /HTTP 500/);

    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await assert.rejects(() => defaultApolloClient()!.peopleMatch("p1"));

    // A clean 200 with no person still returns null (real no-match → the match credit is not charged).
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    assert.equal(await defaultApolloClient()!.peopleMatch("p1"), null);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});

// ─── empty-stage diagnosis × credits ─────────────────────────────────────────
//
// Two things held here:
//   1. each stage value is produced by the adapter condition it names, and
//   2. the credits paired with each stage are EXACTLY what that path can have
//      cost. (2) is the load-bearing half: creditsBilled is what the ledger
//      keeps, so a stage reporting one credit too few is real money undercounted.

interface StageCase {
  stage: ApolloEmptyStage;
  creditsBilled: number;
  client: ApolloClient | null;
}

const found = async () => ({ org: ORG, billed: true, resolver: "organizations/enrich" as const });

const STAGE_CASES: StageCase[] = [
  { stage: "disabled", creditsBilled: 0, client: null },
  { stage: "no_org", creditsBilled: 0, client: client({ resolveOrganization: async () => ({ org: null, billed: false, resolver: "organizations/enrich" }) }) },
  { stage: "org_error", creditsBilled: ORG_RESOLVE_COST_CREDITS, client: client({ resolveOrganization: async () => { throw new Error("HTTP 500"); } }) },
  { stage: "no_people", creditsBilled: ORG_RESOLVE_COST_CREDITS, client: client({ resolveOrganization: found, peopleSearch: async () => [] }) },
  { stage: "people_search_error", creditsBilled: ORG_RESOLVE_COST_CREDITS, client: client({ resolveOrganization: found, peopleSearch: async () => { throw new Error("HTTP 429"); } }) },
  { stage: "no_match", creditsBilled: ORG_RESOLVE_COST_CREDITS, client: client({ resolveOrganization: found, peopleMatch: async () => null }) },
  { stage: "match_no_email", creditsBilled: MAX_CREDITS_PER_ATTEMPT, client: client({ resolveOrganization: found, peopleMatch: async () => ({ email: null }) }) },
  { stage: "match_error", creditsBilled: MAX_CREDITS_PER_ATTEMPT, client: client({ resolveOrganization: found, peopleMatch: async () => { throw new Error("HTTP 500"); } }) },
];

test("every empty stage is produced by the condition it names, with the credits that path cost", async () => {
  for (const c of STAGE_CASES) {
    const r = await apolloResolveAndReveal(input, { client: c.client });
    assert.deepEqual(r, { kind: "empty", creditsBilled: c.creditsBilled, stage: c.stage }, c.stage);
  }
});

test("the vocabulary is exactly the eight stages — the retired free_stage_error is never produced", async () => {
  const produced = new Set<string>();
  for (const c of STAGE_CASES) {
    const r = await apolloResolveAndReveal(input, { client: c.client });
    if (r.kind === "empty") produced.add(r.stage);
  }
  assert.deepEqual(
    [...produced].sort(),
    ["disabled", "match_error", "match_no_email", "no_match", "no_org", "no_people", "org_error", "people_search_error"],
  );
  assert.equal(produced.has("free_stage_error"), false);
});

test("no stage can bill more than the worst case, and only the two paid stages can bill at all", () => {
  for (const c of STAGE_CASES) {
    assert.ok(c.creditsBilled <= MAX_CREDITS_PER_ATTEMPT, c.stage);
  }
  // Stage 1 bills on hit or unknowable; stage 3 bills on match or unknowable.
  // Nothing bills stage 2.
  const stage2Only = STAGE_CASES.filter((c) => c.stage === "no_people" || c.stage === "people_search_error");
  for (const c of stage2Only) assert.equal(c.creditsBilled, ORG_RESOLVE_COST_CREDITS, `${c.stage} bills only what stage 1 cost`);
});

test("a revealed outcome carries no stage and bills the full attempt", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal("stage" in r, false);
  assert.equal(r.creditsBilled, MAX_CREDITS_PER_ATTEMPT);
});

test("stage-1 outcomes are logged at INFO with the rooftop and whether they billed (the funnel line)", async () => {
  const seen: string[] = [];
  const orig = logger.info;
  (logger as unknown as { info: (...a: unknown[]) => void }).info = (...a: unknown[]) => { seen.push(String(a[0])); };
  try {
    await apolloResolveAndReveal({ ...input, rooftopId: "rt-42" }, {
      client: client({ resolveOrganization: async () => ({ org: null, billed: false, resolver: "organizations/enrich" }) }),
    });
  } finally {
    (logger as unknown as { info: typeof orig }).info = orig;
  }
  const line = seen.find((l) => l.includes("stage 1"));
  assert.ok(line, "stage 1 must log before returning a miss");
  assert.match(line!, /rooftop=rt-42/);
  assert.match(line!, /organizations\/enrich/);
  assert.match(line!, /billed=false/);
});
