<<<<<<< HEAD
// Block B / Apollo — adapter 3-stage logic + fail-closed + per-stage credit
// accounting, corrected to Apollo's documented contract.
//
// Injected fake client for the orchestration; the live client is exercised
// with a captured global fetch so the request PATHS and SHAPES are asserted —
// the previous implementation sent an undocumented request to an undocumented
// path, and nothing here caught it because nothing looked at the wire.
=======
// Block B / Apollo — adapter 3-stage logic + fail-closed + billed/not-billed outcome.
// Injected fake client; live HTTP is isolated in defaultApolloClient (staging-verified).
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { logger } from "@/lib/logger";
import {
  apolloResolveAndReveal,
  defaultApolloClient,
<<<<<<< HEAD
  defaultApolloSearchClient,
  ORG_RESOLVE_COST_CREDITS,
  PEOPLE_MATCH_COST_CREDITS,
  MAX_CREDITS_PER_ATTEMPT,
=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  type ApolloClient,
  type ApolloEmptyStage,
} from "../apollo.service";

<<<<<<< HEAD
const ORG = { id: "org1", domain: "toyotaofdallas.com", name: "Toyota of Dallas" };

function client(over: Partial<ApolloClient> = {}): ApolloClient {
  return {
    resolveOrganization: async () => ({ org: ORG, billed: true, resolver: "organizations/enrich" }),
=======
function client(over: Partial<ApolloClient> = {}): ApolloClient {
  return {
    organizationsLookup: async () => ({ id: "org1", domain: "toyotaofdallas.com" }),
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
    peopleSearch: async () => [
      { id: "p1", name: "Ann", title: "Internet Sales Manager", hasEmail: true },
    ],
    peopleMatch: async () => ({ email: "ann@toyotaofdallas.com", name: "Ann", title: "Internet Sales Manager" }),
    ...over,
  };
}
const input = { name: "Toyota of Dallas", website: "https://toyotaofdallas.com", city: "Dallas", state: "TX" };

<<<<<<< HEAD
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
=======
test("no client (no key / disabled) → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: null });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "disabled" });
});

test("3-stage happy path → revealed with the contact", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal(r.kind === "revealed" && r.email, "ann@toyotaofdallas.com");
});

test("org not resolved → empty, NOT billed (never reached the paid call)", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_org" });
});

test("zero people → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_people" });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
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
=======
test("matched but NO email → empty and BILLED (Apollo charged for the match — do not refund)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => ({ email: null }) }),
  });
  assert.deepEqual(r, { kind: "empty", billed: true, stage: "match_no_email" });
});

test("people/match returns NO person (no match) → empty, NOT billed (refundable)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => null }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "no_match" });
});

test("people/match throws → empty and BILLED (cannot know if charged → conservative)", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: true, stage: "match_error" });
});

test("a FREE-stage throw (people search) → empty, NOT billed", async () => {
  const r = await apolloResolveAndReveal(input, {
    client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
  });
  assert.deepEqual(r, { kind: "empty", billed: false, stage: "free_stage_error" });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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

<<<<<<< HEAD
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

=======
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
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
<<<<<<< HEAD
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    await assert.rejects(() => defaultApolloClient()!.peopleMatch("p1"), /HTTP 500/);

    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await assert.rejects(() => defaultApolloClient()!.peopleMatch("p1"));

    // A clean 200 with no person still returns null (real no-match → the match credit is not charged).
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    assert.equal(await defaultApolloClient()!.peopleMatch("p1"), null);
=======
    // HTTP 500 on the paid call.
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const c500 = defaultApolloClient();
    await assert.rejects(() => c500!.peopleMatch("p1"), /HTTP 500/);

    // Network/timeout throw on the paid call.
    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    const cNet = defaultApolloClient();
    await assert.rejects(() => cNet!.peopleMatch("p1"));

    // A clean 200 with no person still returns null (real no-match → not billed).
    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;
    const cOk = defaultApolloClient();
    assert.equal(await cOk!.peopleMatch("p1"), null);
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = prevKey;
    if (prevEnabled === undefined) delete process.env.APOLLO_REVEAL_ENABLED; else process.env.APOLLO_REVEAL_ENABLED = prevEnabled;
  }
});

<<<<<<< HEAD
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
=======
// ─── empty-stage diagnosis ───────────────────────────────────────────────────
//
// An empty reveal used to be one undifferentiated outcome, so a cycle that
// never resolved an organization looked exactly like a cycle whose paid matches
// all came back without a work email — opposite problems, identical evidence.
// `stage` names the drop-off point. These tests hold two things:
//
//   1. each stage value is produced by the adapter condition it names, and
//   2. the `billed` flag paired with each stage is EXACTLY what that branch
//      returned before `stage` existed.
//
// (2) is the load-bearing half. `billed` is what decides whether the ledger
// refunds a credit, so a stage that quietly flipped its pairing would change
// real spend. The table below is that contract in one place, typed as a total
// Record so a new stage cannot be added to the union without landing here.

const BILLED_BY_STAGE: Record<ApolloEmptyStage, boolean> = {
  disabled: false, // never called Apollo at all
  no_org: false, // stage 1 miss — free
  no_people: false, // stage 2 miss — free
  free_stage_error: false, // threw before the paid call — free
  no_match: false, // clean 200, no person — Apollo does not charge
  match_no_email: true, // Apollo charges for the match, email or not
  match_error: true, // unknowable → assume charged, never undercount
};

interface StageCase {
  stage: ApolloEmptyStage;
  why: string;
  run: () => ReturnType<typeof apolloResolveAndReveal>;
}

const STAGE_CASES: StageCase[] = [
  {
    stage: "disabled",
    why: "no client — no API key or APOLLO_REVEAL_ENABLED is not \"true\"",
    run: () => apolloResolveAndReveal(input, { client: null }),
  },
  {
    stage: "no_org",
    why: "organizations/lookup resolved no canonical org",
    run: () => apolloResolveAndReveal(input, { client: client({ organizationsLookup: async () => null }) }),
  },
  {
    stage: "no_people",
    why: "people search returned zero people for the org",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleSearch: async () => [] }) }),
  },
  {
    stage: "free_stage_error",
    why: "stage 1 (organizations/lookup) threw",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ organizationsLookup: async () => { throw new Error("apollo 500 on lookup"); } }),
      }),
  },
  {
    stage: "free_stage_error",
    why: "stage 2 (people search) threw",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
      }),
  },
  {
    stage: "no_match",
    why: "people/match matched no person (clean 200)",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleMatch: async () => null }) }),
  },
  {
    stage: "match_no_email",
    why: "people/match matched a person carrying no work email",
    run: () => apolloResolveAndReveal(input, { client: client({ peopleMatch: async () => ({ email: null }) }) }),
  },
  {
    stage: "match_error",
    why: "people/match threw — charged or not is unknowable",
    run: () =>
      apolloResolveAndReveal(input, {
        client: client({ peopleMatch: async () => { throw new Error("apollo 500 on match"); } }),
      }),
  },
];

for (const c of STAGE_CASES) {
  test(`stage "${c.stage}" is produced by: ${c.why}`, async () => {
    const r = await c.run();
    assert.equal(r.kind, "empty", "this condition must not reveal a contact");
    assert.deepEqual(r, { kind: "empty", billed: BILLED_BY_STAGE[c.stage], stage: c.stage });
  });
}

test("every stage in the union has a producing condition covered above", () => {
  const declared = Object.keys(BILLED_BY_STAGE).sort();
  const covered = [...new Set(STAGE_CASES.map((c) => c.stage))].sort();
  assert.deepEqual(
    covered,
    declared,
    "a stage exists that no test produces (or a test produces a stage the union no longer declares) — " +
      "add the case to STAGE_CASES rather than deleting the stage",
  );
});

test("the revealed outcome carries no stage — stage is an EMPTY-only diagnosis", async () => {
  const r = await apolloResolveAndReveal(input, { client: client() });
  assert.equal(r.kind, "revealed");
  assert.equal("stage" in r, false);
  assert.equal("billed" in r, false);
});

test("billed pairings are unchanged: exactly the two paid-stage outcomes bill", () => {
  // Frozen deliberately. Before `stage` existed the adapter billed on exactly
  // two branches — a match with no email, and an errored match — and refunded
  // on the other five. Anything that widens the billing set here overspends the
  // cap; anything that narrows it undercounts real Apollo spend.
  const billed = Object.entries(BILLED_BY_STAGE).filter(([, b]) => b).map(([s]) => s).sort();
  assert.deepEqual(billed, ["match_error", "match_no_email"]);
  const refunded = Object.entries(BILLED_BY_STAGE).filter(([, b]) => !b).map(([s]) => s).sort();
  assert.deepEqual(refunded, ["disabled", "free_stage_error", "no_match", "no_org", "no_people"]);
});

// ─── the free-stage funnel logs ──────────────────────────────────────────────
//
// The stage field explains a SINGLE empty; these two lines explain a RUN. They
// are the only way to see, from logs alone, that (say) 900 rooftops resolved an
// org and 870 of them then returned zero people. Deleting them is silent
// otherwise — so they are asserted here rather than left to inspection.

/** Capture logger output at a given level for the duration of one call. */
async function captureLogs<T>(level: "info" | "warn", fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = logger[level];
  logger[level] = ((message: string, ...rest: unknown[]) => {
    lines.push(message);
    void rest;
  }) as typeof original;
  try {
    return { result: await fn(), lines };
  } finally {
    logger[level] = original;
  }
}

const keyed = { ...input, rooftopId: "rt-42" };

test("free stage 1 logs the resolved org id at INFO, keyed by rooftop", async () => {
  const { lines } = await captureLogs("info", () => apolloResolveAndReveal(keyed, { client: client() }));
  const stage1 = lines.find((l) => l.includes("stage 1 org lookup"));
  assert.ok(stage1, `no stage-1 info line; got: ${JSON.stringify(lines)}`);
  assert.match(stage1!, /rooftop=rt-42/);
  assert.match(stage1!, /org=org1/); // the id Apollo resolved, not a placeholder
});

test("free stage 2 logs the people count at INFO, keyed by rooftop and org", async () => {
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, {
      client: client({
        peopleSearch: async () => [
          { id: "a", name: "A", title: "Sales Manager", hasEmail: true },
          { id: "b", name: "B", title: "Sales Manager", hasEmail: false },
        ],
        peopleMatch: async () => ({ email: "a@b.com" }),
      }),
    }),
  );
  const stage2 = lines.find((l) => l.includes("stage 2 people search"));
  assert.ok(stage2, `no stage-2 info line; got: ${JSON.stringify(lines)}`);
  assert.match(stage2!, /rooftop=rt-42/);
  assert.match(stage2!, /org=org1/);
  assert.match(stage2!, /people=2/); // the real count, not a boolean
});

test("the drop-off is visible on a MISS too — an unresolved org still logs org=none", async () => {
  // The funnel is worthless if it only records the rooftops that got through.
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, { client: client({ organizationsLookup: async () => null }) }),
  );
  const stage1 = lines.find((l) => l.includes("stage 1 org lookup"));
  assert.ok(stage1, "an org miss must still emit the stage-1 line");
  assert.match(stage1!, /rooftop=rt-42 org=none/);
  assert.equal(lines.some((l) => l.includes("stage 2 people search")), false); // never reached
});

test("a zero-people org logs people=0 — the drop-off between stage 1 and 2", async () => {
  const { lines } = await captureLogs("info", () =>
    apolloResolveAndReveal(keyed, { client: client({ peopleSearch: async () => [] }) }),
  );
  assert.ok(lines.some((l) => /stage 1 org lookup .*org=org1/.test(l)));
  assert.ok(lines.some((l) => /stage 2 people search .*people=0/.test(l)));
});

test("the funnel lines are INFO, not warn — an ordinary miss is not a fault", async () => {
  const { lines: warnLines } = await captureLogs("warn", () =>
    apolloResolveAndReveal(keyed, { client: client({ organizationsLookup: async () => null }) }),
  );
  assert.deepEqual(warnLines, [], "an org miss must not warn — it is an ordinary outcome");
});

test("a free-stage THROW still warns (that one IS a fault) and names the rooftop", async () => {
  const { lines } = await captureLogs("warn", () =>
    apolloResolveAndReveal(keyed, {
      client: client({ peopleSearch: async () => { throw new Error("apollo 500 on search"); } }),
    }),
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /free stages\) failed — rooftop=rt-42/);
});

test("without a rooftop id the funnel line still emits, keyed \"unknown\"", async () => {
  // A grep for the funnel must never silently skip a row just because a caller
  // outside the reveal orchestration drove the adapter.
  const { lines } = await captureLogs("info", () => apolloResolveAndReveal(input, { client: client() }));
  assert.ok(lines.some((l) => l.includes("rooftop=unknown")));
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
});
