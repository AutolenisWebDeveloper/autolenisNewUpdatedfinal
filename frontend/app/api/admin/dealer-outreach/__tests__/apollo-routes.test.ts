// HTTP surface for the Apollo People Search chain.
//
// WHY THESE EXIST. runPeopleSearch, matchApolloOrgToRooftop, previewEnrichment
// and runEnrichment were built, unit-tested, and then never called: production
// held 0 apollo_person_candidates and 0 apollo_enrichment_runs. These routes are
// the callers, and these tests assert the property that matters most about them —
// the free path is free.
//
// THE COST ASSERTION IS STRUCTURAL, NOT NOMINAL. The credit-ledger module is
// mocked so that EVERY export throws while `forbidLedger` is set. A search that
// reached a draw, a refund, or even a remaining-balance read would therefore
// return 500 instead of 200. The Apollo transport is mocked too, so the test can
// name every endpoint the route touched: /mixed_people/api_search (free) and never
// /people/match (the billable reveal). A future edit that routes discovery
// through a paid call fails here rather than on an invoice.
//
// Run: pnpm test:admin-dealers

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";

// ── controllable caller ──────────────────────────────────────────────────────
type Caller = { adminId: string; email: string; role: string; mfaVerified: boolean } | null;
let caller: Caller = null;

// ── the cost guard ───────────────────────────────────────────────────────────
// Every ledger export records that it was reached and, while forbidLedger is on,
// throws. Recording AND throwing so a failure is unambiguous either way.
let forbidLedger = true;
let ledgerCalls: string[] = [];
let ledgerRemainingValue = 500;
// Whether the mocked ledger has budget for a draw, and what it then holds.
let ledgerHasBudget = false;
let ledgerSpent = 0;
// Ledger and transport events in the order they happened, so a test can assert
// the draw came BEFORE the paid call rather than merely that both occurred.
let timeline: string[] = [];

const ledgerGuard = (name: string) => {
  ledgerCalls.push(name);
  if (forbidLedger) throw new Error(`the credit ledger must not be reachable here (${name})`);
};

mock.module("@/lib/services/dealer-recruitment/apollo-credit-ledger.service", {
  namedExports: {
    RESERVE_CREDITS: 500,
    RESERVE_RELEASE_DAY: 25,
    backfillReserveFloor: () => {
      ledgerGuard("backfillReserveFloor");
      return 0;
    },
    drawCredits: async ({ cost }: { cost: number }) => {
      ledgerGuard("drawCredits");
      timeline.push("ledger:draw");
      if (!ledgerHasBudget) return { drawn: false as const, reason: "insufficient" as const };
      ledgerSpent += cost;
      return { drawn: true as const };
    },
    refundCredits: async (_cycleKey: string, cost: number) => {
      ledgerGuard("refundCredits");
      timeline.push("ledger:refund");
      ledgerSpent -= cost;
    },
    remainingCredits: async () => {
      ledgerGuard("remainingCredits");
      return ledgerRemainingValue;
    },
    cycleKeyFor: () => "2026-09",
    daysInCycleFor: () => 30,
    getOrCreateCycle: async () => {
      ledgerGuard("getOrCreateCycle");
      return { id: "l1", cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 };
    },
    ensureCurrentCycleLedger: async () => {
      ledgerGuard("ensureCurrentCycleLedger");
      return { id: "l1", cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 };
    },
    DEFAULT_CYCLE_CAP_CREDITS: 2000,
  },
});

// ── Apollo transport ─────────────────────────────────────────────────────────
let apolloPaths: string[] = [];
let searchPeople: Array<Record<string, unknown>> = [];
// What people/match answers when a test enables the paid reveal; null = no match.
let matchPerson: Record<string, unknown> | null = null;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof url === "string" ? url : url.toString();
  if (!href.includes("apollo.io")) return realFetch(url as RequestInfo, init);
  const path = new URL(href).pathname;
  apolloPaths.push(path);
  timeline.push(`apollo:${path}`);
  if (path.endsWith("/people/match")) {
    return new Response(JSON.stringify(matchPerson ? { person: matchPerson } : {}), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (path.endsWith("/mixed_people/api_search")) {
    return new Response(
      JSON.stringify({ people: searchPeople, pagination: { total_pages: 1, total_entries: searchPeople.length } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  // Any other Apollo endpoint reached from these routes is a defect; answer in a
  // way that cannot be mistaken for success.
  return new Response(JSON.stringify({ error: "unexpected endpoint" }), { status: 500 });
}) as typeof globalThis.fetch;

// ── prisma fake ──────────────────────────────────────────────────────────────
interface Candidate {
  id: string;
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  organizationName: string | null;
  organizationDomain: string | null;
  organizationCity: string | null;
  organizationState: string | null;
  organizationZip: string | null;
  rooftopId: string | null;
  matchMethod: string | null;
  matchConfidence: string | null;
  enrichmentStatus: string;
  lastSyncedAt: Date | null;
  searchRunKey: string;
  createdAt: Date;
  [k: string]: unknown;
}

let candidates: Candidate[] = [];
let rooftops: Array<Record<string, unknown>> = [];
let runsCreated: Array<Record<string, unknown>> = [];
let seq = 0;

const prismaFake = {
  apolloPersonCandidate: {
    upsert: async ({ where, create, update }: { where: { apolloPersonId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const existing = candidates.find((c) => c.apolloPersonId === where.apolloPersonId);
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      // The nullable columns the search insert does not set arrive as NULL, not
      // as absent — the match pass selects on `rooftopId: null`.
      const row = {
        id: `c_${++seq}`,
        createdAt: new Date(),
        rooftopId: null,
        matchMethod: null,
        matchConfidence: null,
        lastSyncedAt: null,
        ...create,
      } as Candidate;
      candidates.push(row);
      return row;
    },
    findMany: async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number } = {}) =>
      candidates
        .filter((c) => {
          if (where.searchRunKey !== undefined && c.searchRunKey !== where.searchRunKey) return false;
          if (where.rooftopId === null && c.rooftopId !== null) return false;
          const st = where.enrichmentStatus as { in?: string[] } | undefined;
          if (st?.in && !st.in.includes(c.enrichmentStatus)) return false;
          return true;
        })
        .slice(0, take ?? undefined)
        .map((c) => ({ ...c })),
    findUnique: async ({ where }: { where: { apolloPersonId?: string; id?: string } }) =>
      candidates.find(
        (c) => (where.apolloPersonId && c.apolloPersonId === where.apolloPersonId) || (where.id && c.id === where.id),
      ) ?? null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = candidates.find((c) => c.id === where.id);
      if (row) Object.assign(row, data);
      return row;
    },
    updateMany: async () => ({ count: 0 }),
    count: async () => candidates.length,
    groupBy: async () => [],
  },
  dealerRooftop: {
    findMany: async () => rooftops.map((r) => ({ ...r })),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `rt_${++seq}`, ...data };
      rooftops.push(row);
      return row;
    },
    count: async () => rooftops.length,
  },
  dealerProspect: { findMany: async () => [] },
  dealerContactProfile: {
    findUnique: async () => null,
    findFirst: async () => null,
    create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "prof_1", ...data }),
    update: async ({ data }: { data: Record<string, unknown> }) => ({ id: "prof_1", ...data }),
    count: async () => 0,
  },
  apolloEnrichmentRun: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      runsCreated.push(data);
      return { id: `run_${runsCreated.length}`, ...data };
    },
    count: async () => runsCreated.length,
    aggregate: async () => ({ _sum: { creditsSpent: 0 } }),
    findFirst: async () => null,
  },
  adminAuditLog: { create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "audit_1", ...data }) },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFake } });

// The real response helpers and the real role list — only the session lookup is
// faked, so the authorization rule under test is the route's own.
mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminSuccess,
    adminError,
    OPERATIONAL_ROLES,
    getClientIp: () => null,
    createAuditLog: async () => ({ id: "audit_1" }),
    getAdminFromRequest: async () => caller,
  },
});

const SEARCH_ROUTE = "@/app/api/admin/dealer-outreach/apollo/search/route";
const ENRICH_ROUTE = "@/app/api/admin/dealer-outreach/apollo/enrich/route";

const post = async (mod: string, body: unknown) => {
  const { POST } = (await import(mod)) as { POST: (r: Request) => Promise<Response> };
  const req = new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req as never);
};

const json = async <T>(res: Response): Promise<T> => (await res.json()) as T;

beforeEach(() => {
  caller = { adminId: "admin_1", email: "ops@autolenis.com", role: "OPERATIONS_ADMIN", mfaVerified: true };
  candidates = [];
  rooftops = [];
  runsCreated = [];
  ledgerCalls = [];
  apolloPaths = [];
  seq = 0;
  forbidLedger = true;
  ledgerRemainingValue = 500;
  ledgerHasBudget = false;
  ledgerSpent = 0;
  timeline = [];
  searchPeople = [];
  matchPerson = null;
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_PEOPLE_SEARCH_ENABLED = "true";
  delete process.env.APOLLO_REVEAL_ENABLED;
  delete process.env.APOLLO_ENRICHMENT_ENABLED;
  delete process.env.APOLLO_WATERFALL_ENABLED;
  delete process.env.APOLLO_ENRICHMENT_MAX_CREDITS;
});

// ── authorization ────────────────────────────────────────────────────────────

test("both Apollo routes refuse an unauthenticated caller", async () => {
  caller = null;
  for (const mod of [SEARCH_ROUTE, ENRICH_ROUTE]) {
    const res = await post(mod, { states: ["Texas, US"] });
    assert.equal(res.status, 401, `${mod} must 401 without a session`);
  }
  assert.equal(candidates.length, 0, "an unauthenticated call must not write a candidate");
});

test("MFA is required — getAdminFromRequest rejects a token without it, mirroring coverage", async () => {
  // The session helper is what enforces MFA; a caller it refuses arrives as null.
  caller = null;
  const res = await post(SEARCH_ROUTE, { states: ["Texas, US"] });
  assert.equal(res.status, 401);
});

test("a read-only SUPPORT_ADMIN can neither search nor enrich", async () => {
  caller = { adminId: "admin_2", email: "support@autolenis.com", role: "SUPPORT_ADMIN", mfaVerified: true };
  for (const mod of [SEARCH_ROUTE, ENRICH_ROUTE]) {
    const res = await post(mod, { states: ["Texas, US"] });
    assert.equal(res.status, 403, `${mod} must 403 for a read-only role`);
  }
});

// ── search: the free path, proven free ──────────────────────────────────────

test("search reaches ONLY the free endpoint and NO ledger call is reachable from it", async () => {
  searchPeople = [
    {
      id: "apollo_p1",
      first_name: "Jordan",
      last_name: "R.",
      title: "General Manager",
      organization: {
        id: "apollo_o1",
        name: "Round Rock Toyota",
        city: "Round Rock",
        state: "TX",
        postal_code: "78664",
        primary_domain: "roundrocktoyota.com",
      },
    },
  ];

  const res = await post(SEARCH_ROUTE, { states: ["Texas, US"], maxPages: 1 });
  assert.equal(res.status, 200, "a search that touched the ledger would have thrown and 500'd");

  const body = await json<{ data: { search: { persisted: number }; match: { strongMatch: number; processed: number }; spendsCredits: boolean } }>(res);
  assert.equal(body.data.spendsCredits, false);
  assert.equal(body.data.search.persisted, 1);

  assert.deepEqual(ledgerCalls, [], "the free discovery path must not reach the credit ledger at all");
  assert.deepEqual(
    [...new Set(apolloPaths)],
    ["/api/v1/mixed_people/api_search"],
    "people/match is the billable call and must never be reached by discovery",
  );
});

test("every new candidate is resolved to a rooftop, with the confidence recorded", async () => {
  rooftops = [
    {
      id: "rt_existing",
      displayName: "Round Rock Toyota",
      websiteHost: "roundrocktoyota.com",
      nameZipKey: null,
      nameCityStateKey: null,
      phoneKey: null,
    },
  ];
  searchPeople = [
    {
      id: "apollo_p1",
      first_name: "Jordan",
      last_name: "R.",
      title: "General Manager",
      organization: { id: "apollo_o1", name: "Round Rock Toyota", city: "Round Rock", state: "TX", postal_code: "78664", primary_domain: "roundrocktoyota.com" },
    },
    {
      id: "apollo_p2",
      first_name: "Sam",
      last_name: "T.",
      title: "Used Car Manager",
      organization: { id: "apollo_o1", name: "Round Rock Toyota", city: "Round Rock", state: "TX", postal_code: "78664", primary_domain: "roundrocktoyota.com" },
    },
  ];

  const res = await post(SEARCH_ROUTE, { states: ["Texas, US"], maxPages: 1 });
  const body = await json<{ data: { match: { processed: number; organizations: number; strongMatch: number; strongMatchRate: number; byMethod: Record<string, number> } } }>(res);

  assert.equal(body.data.match.processed, 2);
  assert.equal(body.data.match.organizations, 1, "two people, one organization, one resolution");
  assert.equal(body.data.match.byMethod.website_host, 2, "a shared real domain is the strongest evidence");
  assert.equal(body.data.match.strongMatch, 2);
  assert.equal(body.data.match.strongMatchRate, 1);
  for (const c of candidates) {
    assert.equal(c.rooftopId, "rt_existing");
    assert.equal(c.matchConfidence, "high");
  }
});

test("search is refused without a usable location list, and writes nothing", async () => {
  for (const bad of [{}, { states: [] }, { states: ["  "] }, { states: [42] }, { states: "Texas" }]) {
    const res = await post(SEARCH_ROUTE, bad);
    assert.equal(res.status, 400, `${JSON.stringify(bad)} must be refused`);
  }
  assert.equal(apolloPaths.length, 0, "a refused request must not call Apollo");
  assert.equal(candidates.length, 0);
});

test("a disabled search flag is reported as such rather than as an empty market", async () => {
  delete process.env.APOLLO_PEOPLE_SEARCH_ENABLED;
  const res = await post(SEARCH_ROUTE, { states: ["Texas, US"] });
  assert.equal(res.status, 200);
  const body = await json<{ data: { search: { skipped: boolean }; skippedReason: string | null } }>(res);
  assert.equal(body.data.search.skipped, true);
  assert.match(String(body.data.skippedReason), /APOLLO_PEOPLE_SEARCH_ENABLED/);
  assert.equal(apolloPaths.length, 0);
});

// ── enrich: preview is the default, execute must be asked for ───────────────

test("an omitted mode previews, spends nothing, and reaches no billable endpoint", async () => {
  forbidLedger = false; // a preview legitimately READS the remaining balance
  const res = await post(ENRICH_ROUTE, {});
  assert.equal(res.status, 200);

  const body = await json<{ data: { mode: string; spendsCredits: boolean; preview: { candidateCount: number; worstCaseCredits: number; runId: string | null } } }>(res);
  assert.equal(body.data.mode, "preview");
  assert.equal(body.data.spendsCredits, false);
  // The response names the row that records the run, so "0 credits" is followed
  // back to an audit record rather than taken on trust.
  assert.equal(body.data.preview.runId, "run_1");
  assert.ok(ledgerCalls.includes("remainingCredits"), "a preview must quote the real remaining balance");
  assert.equal(apolloPaths.length, 0, "a preview calls no Apollo endpoint at all");
  assert.equal(runsCreated.length, 1);
  assert.equal(runsCreated[0].mode, "preview");
  assert.equal(runsCreated[0].creditsSpent, 0);
});

test("execute refuses without an explicit maxCredits — a spend is never implied", async () => {
  forbidLedger = false;
  const res = await post(ENRICH_ROUTE, { mode: "execute" });
  assert.equal(res.status, 400);
  const body = await json<{ error: { code: string } }>(res);
  assert.equal(body.error.code, "MAX_CREDITS_REQUIRED");
  assert.equal(runsCreated.length, 0, "a refused execute must not even record a run");
  assert.equal(apolloPaths.length, 0);
});

test("an unrecognised mode is refused rather than falling through to the cheaper branch", async () => {
  forbidLedger = false;
  const res = await post(ENRICH_ROUTE, { mode: "exceute" });
  assert.equal(res.status, 400);
  assert.equal((await json<{ error: { code: string } }>(res)).error.code, "INVALID_MODE");
  assert.equal(runsCreated.length, 0);
});

test("a non-positive maxCredits is refused", async () => {
  forbidLedger = false;
  for (const v of [0, -5, "many"]) {
    const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: v });
    assert.equal(res.status, 400, `maxCredits=${v} must be refused`);
  }
  assert.equal(apolloPaths.length, 0);
});

test("execute while the enrichment flag is off spends nothing and says why", async () => {
  forbidLedger = false;
  const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 });
  assert.equal(res.status, 200);

  const body = await json<{ data: { run: { status: string; creditsSpent: number; abortReason?: string } } }>(res);
  assert.equal(body.data.run.status, "ABORTED_DISABLED");
  assert.equal(body.data.run.creditsSpent, 0);
  assert.equal(apolloPaths.length, 0, "no Apollo call while the flag is off");
  assert.equal(runsCreated.length, 1, "the aborted run is still recorded — spend must stay auditable");
  assert.equal(runsCreated[0].status, "ABORTED_DISABLED");
  const withId = await json<{ data: { run: { runId: string | null } } }>(
    await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 }),
  );
  assert.equal(withId.data.run.runId, "run_2", "the response names the run row");
});

test("enrichment enabled but reveal disabled aborts before the loop instead of billing blind", async () => {
  // Without APOLLO_REVEAL_ENABLED there is no Apollo client, so no reveal
  // implementation is supplied. Counting a credit per candidate for calls that
  // were never made is exactly what this guards against.
  forbidLedger = false;
  process.env.APOLLO_ENRICHMENT_ENABLED = "true";
  candidates = [
    {
      id: "c1",
      apolloPersonId: "p1",
      apolloOrganizationId: "o1",
      organizationName: "Round Rock Toyota",
      organizationDomain: "roundrocktoyota.com",
      organizationCity: "Round Rock",
      organizationState: "TX",
      organizationZip: "78664",
      rooftopId: "rt_existing",
      matchMethod: "website_host",
      matchConfidence: "high",
      enrichmentStatus: "NEW",
      lastSyncedAt: null,
      searchRunKey: "ps_run",
      createdAt: new Date(),
    },
  ];

  const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 });
  const body = await json<{ data: { run: { status: string; creditsSpent: number; abortReason?: string } } }>(res);
  assert.equal(body.data.run.status, "ABORTED_ERROR");
  assert.equal(body.data.run.creditsSpent, 0);
  assert.match(String(body.data.run.abortReason), /reveal implementation/);
  assert.equal(apolloPaths.length, 0);
});

test("execute is refused while the waterfall flag is on, because the preview would misquote it", async () => {
  forbidLedger = false;
  process.env.APOLLO_WATERFALL_ENABLED = "true";
  const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 });
  assert.equal(res.status, 409);
  assert.equal((await json<{ error: { code: string } }>(res)).error.code, "WATERFALL_UNSUPPORTED");
  assert.equal(runsCreated.length, 0);
  assert.equal(apolloPaths.length, 0);
});

test("the enrichment cap never exceeds what the ledger reports remaining", async () => {
  forbidLedger = false;
  ledgerRemainingValue = 7;
  process.env.APOLLO_ENRICHMENT_MAX_CREDITS = "1000";
  const res = await post(ENRICH_ROUTE, { mode: "preview", maxCredits: 900 });
  const body = await json<{ data: { preview: { maxCredits: number; creditsRemaining: number } } }>(res);
  assert.equal(body.data.preview.maxCredits, 7, "the effective cap is the minimum of request, config and ledger");
  assert.equal(body.data.preview.creditsRemaining, 7);
});

// ── enrich: the draw precedes the paid call ─────────────────────────────────
//
// Until this batch runEnrichment tallied its spend in memory and never touched
// ApolloCreditLedger. These two tests run the REAL job through the route with
// the paid reveal enabled: the mocked ledger records every draw in a timeline
// alongside every Apollo call, so "the draw came first" is asserted as an
// ordering, and a ledger with no budget is shown to keep people/match unreached.

const strongCandidate = (): Candidate => ({
  id: "c1",
  apolloPersonId: "p1",
  apolloOrganizationId: "o1",
  organizationName: "Round Rock Toyota",
  organizationDomain: "roundrocktoyota.com",
  organizationCity: "Round Rock",
  organizationState: "TX",
  organizationZip: "78664",
  rooftopId: "rt_existing",
  matchMethod: "website_host",
  matchConfidence: "high",
  enrichmentStatus: "NEW",
  lastSyncedAt: null,
  searchRunKey: "ps_run",
  createdAt: new Date(),
});

test("execute draws a credit from the ledger BEFORE the paid call and records the net spend", async () => {
  forbidLedger = false;
  ledgerHasBudget = true;
  process.env.APOLLO_ENRICHMENT_ENABLED = "true";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  candidates = [strongCandidate()];
  matchPerson = { email: "gm@roundrocktoyota.com", name: "Pat Example", title: "General Manager" };

  const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 });
  assert.equal(res.status, 200);
  const body = await json<{ data: { run: { status: string; creditsSpent: number; creditsDrawn: number; creditsRefunded: number; enrichedCount: number } } }>(res);
  assert.equal(body.data.run.status, "COMPLETED");
  assert.equal(body.data.run.creditsDrawn, 1);
  assert.equal(body.data.run.creditsSpent, 1);
  assert.equal(body.data.run.creditsRefunded, 0);
  assert.equal(body.data.run.enrichedCount, 1);

  const draw = timeline.indexOf("ledger:draw");
  const paid = timeline.findIndex((e) => e.startsWith("apollo:") && e.endsWith("/people/match"));
  assert.ok(draw !== -1 && paid !== -1 && draw < paid, `the draw must precede the paid call: ${timeline.join(" → ")}`);
  assert.equal(apolloPaths.filter((p) => p.endsWith("/people/match")).length, 1);
  assert.equal(ledgerSpent, 1, "the ledger holds exactly the one credit the run reports");
  assert.equal(runsCreated[0].creditsSpent, 1, "apollo_enrichment_runs records what the ledger moved");
  assert.equal(candidates[0].enrichmentStatus, "ENRICHED");
});

test("a refused draw makes NO paid call, marks the candidate SKIPPED_CAP, and aborts the run", async () => {
  forbidLedger = false;
  ledgerHasBudget = false; // nothing above the reserve floor this cycle
  process.env.APOLLO_ENRICHMENT_ENABLED = "true";
  process.env.APOLLO_REVEAL_ENABLED = "true";
  candidates = [strongCandidate()];
  matchPerson = { email: "gm@roundrocktoyota.com" };

  const res = await post(ENRICH_ROUTE, { mode: "execute", maxCredits: 10 });
  assert.equal(res.status, 200);
  const body = await json<{ data: { run: { status: string; creditsSpent: number; abortReason?: string } } }>(res);
  assert.equal(body.data.run.status, "ABORTED_CAP");
  assert.equal(body.data.run.creditsSpent, 0);
  assert.match(String(body.data.run.abortReason), /refused/);
  assert.match(String(body.data.run.abortReason), /1 candidate\(s\) not attempted/);
  assert.equal(apolloPaths.some((p) => p.endsWith("/people/match")), false, "no paid call without a draw");
  assert.ok(ledgerCalls.includes("drawCredits"), "the draw was attempted");
  assert.equal(ledgerSpent, 0);
  assert.equal(candidates[0].enrichmentStatus, "SKIPPED_CAP");
  assert.equal(candidates[0].lastSyncedAt, null, "an unattempted candidate is not marked synced");
  assert.equal(runsCreated[0].status, "ABORTED_CAP");
});
