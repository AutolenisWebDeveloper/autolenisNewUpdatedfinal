// Phase 1.7 — the wiring that gives the Apollo People Search chain a caller.
//
// WHAT THESE PROVE. The chain's units were already tested in isolation; what was
// never tested is that real implementations exist behind their dependencies and
// behave when the database misbehaves. So: the match pass resolves one
// organization once (not once per person), records its verdict even when nothing
// matched, and survives a row that will not write; the enrichment deps select
// only re-attemptable candidates, refuse to re-buy a person we already hold fresh
// detail for, and — critically — NEVER throw, because runEnrichment does not
// guard persistContact/updateCandidate and an exception there would skip the run
// record, leaving credits spent with no audit row.
//
// Runs under base `pnpm test` (lib/services/dealer-recruitment/__tests__).
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-orchestration.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  resolveCandidateRooftops,
  runPeopleSearchAndMatch,
  selectEnrichmentCandidates,
  isPersonAlreadyEnriched,
  persistApolloContact,
  updateEnrichmentCandidate,
  persistEnrichmentRun,
  STRONG_MATCH_CONFIDENCES,
  WEAK_MATCH_METHODS,
  type OrchestrationDeps,
} from "../apollo-orchestration.service";
import { previewEnrichment } from "../apollo-enrichment-job.service";
import type { OrgMatchResult } from "../apollo-org-match.service";
import type { PeopleSearchResult } from "../apollo-people-search.service";

const NOW = new Date("2026-09-07T12:00:00Z");
const DAY = 86_400_000;

// ── in-memory prisma ─────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
  linkedinUrl: string | null;
  organizationName: string | null;
  organizationDomain: string | null;
  organizationCity: string | null;
  organizationState: string | null;
  organizationZip: string | null;
  rooftopId: string | null;
  matchMethod: string | null;
  matchConfidence: string | null;
  enrichmentStatus: string;
  enrichmentError: string | null;
  lastSyncedAt: Date | null;
  searchRunKey: string;
  createdAt: Date;
}

interface ProfileRow {
  id: string;
  rooftopId: string;
  name: string | null;
  nameKey: string | null;
  title: string | null;
  email: string | null;
  emailKey: string | null;
  phone: string | null;
  phoneKey: string | null;
  emailVerificationStatus: string | null;
  apolloPersonId: string | null;
  apolloOrganizationId: string | null;
  apolloLastSyncedAt: Date | null;
  dncStatus: string | null;
  dncCheckedAt: Date | null;
  phoneType: string | null;
  linkedinUrl: string | null;
  [k: string]: unknown;
}

interface ProspectRow {
  rooftopId: string | null;
  status: string;
  buyerOppId: string | null;
  searchScore: number | null;
}

interface Store {
  candidates: CandidateRow[];
  profiles: ProfileRow[];
  prospects: ProspectRow[];
  runs: Record<string, unknown>[];
  failCandidateUpdate: Set<string>;
  failProfileUpdate: Set<string>;
}

const cand = (over: Partial<CandidateRow> = {}): CandidateRow => ({
  id: "c1",
  apolloPersonId: "p1",
  apolloOrganizationId: "org1",
  firstName: "Jordan",
  lastNameObfuscated: "R.",
  title: "General Manager",
  linkedinUrl: "https://linkedin.test/jordan",
  organizationName: "Round Rock Toyota",
  organizationDomain: "roundrocktoyota.com",
  organizationCity: "Round Rock",
  organizationState: "TX",
  organizationZip: "78664",
  rooftopId: null,
  matchMethod: null,
  matchConfidence: null,
  enrichmentStatus: "NEW",
  enrichmentError: null,
  lastSyncedAt: null,
  searchRunKey: "ps_run",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

function fakePrisma(store: Store): PrismaClient {
  const matchWhere = (row: CandidateRow, where: Record<string, unknown>): boolean => {
    if (where.searchRunKey !== undefined && row.searchRunKey !== where.searchRunKey) return false;
    if (where.rooftopId === null && row.rooftopId !== null) return false;
    const st = where.enrichmentStatus as { in?: string[] } | undefined;
    if (st?.in && !st.in.includes(row.enrichmentStatus)) return false;
    return true;
  };

  return {
    apolloPersonCandidate: {
      findMany: async ({ where = {}, take }: { where?: Record<string, unknown>; take?: number } = {}) =>
        store.candidates
          .filter((r) => matchWhere(r, where))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .slice(0, take ?? undefined)
          .map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { apolloPersonId?: string; id?: string } }) => {
        const row = store.candidates.find(
          (r) => (where.apolloPersonId && r.apolloPersonId === where.apolloPersonId) || (where.id && r.id === where.id),
        );
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (store.failCandidateUpdate.has(where.id)) throw new Error("candidate update refused");
        const row = store.candidates.find((r) => r.id === where.id);
        if (!row) throw new Error("candidate not found");
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: { where: { apolloPersonId: string }; data: Record<string, unknown> }) => {
        const rows = store.candidates.filter((r) => r.apolloPersonId === where.apolloPersonId);
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    dealerProspect: {
      findMany: async ({ where }: { where: { rooftopId: { in: string[] } } }) =>
        store.prospects.filter((p) => p.rooftopId && where.rooftopId.in.includes(p.rooftopId)).map((p) => ({ ...p })),
    },
    dealerContactProfile: {
      findUnique: async ({ where }: { where: { apolloPersonId?: string; id?: string } }) => {
        const row = store.profiles.find(
          (p) => (where.apolloPersonId && p.apolloPersonId === where.apolloPersonId) || (where.id && p.id === where.id),
        );
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = store.profiles.find(
          (p) =>
            p.rooftopId === where.rooftopId &&
            (where.emailKey === undefined || p.emailKey === where.emailKey) &&
            (where.nameKey === undefined || p.nameKey === where.nameKey) &&
            (where.phoneKey === undefined || p.phoneKey === where.phoneKey),
        );
        return row ? { ...row } : null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `prof_${store.profiles.length + 1}`, ...data } as ProfileRow;
        store.profiles.push(row);
        return { ...row };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        if (store.failProfileUpdate.has(where.id)) throw new Error("profile update refused");
        const row = store.profiles.find((p) => p.id === where.id);
        if (!row) throw new Error("profile not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    apolloEnrichmentRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        store.runs.push(data);
        return { id: `run_${store.runs.length}`, ...data };
      },
    },
  } as unknown as PrismaClient;
}

const newStore = (over: Partial<Store> = {}): Store => ({
  candidates: [],
  profiles: [],
  prospects: [],
  runs: [],
  failCandidateUpdate: new Set(),
  failProfileUpdate: new Set(),
  ...over,
});

const match = (over: Partial<OrgMatchResult> = {}): OrgMatchResult => ({
  rooftopId: "rt_1",
  method: "website_host",
  confidence: "high",
  created: false,
  ambiguous: false,
  candidateCount: 1,
  ...over,
});

const matchFake = (
  results: OrgMatchResult[] | OrgMatchResult,
  calls: Array<{ name: string | null; domain: string | null }> = [],
): OrchestrationDeps["matchOrg"] =>
  (async (org: { name: string | null; domain: string | null }) => {
    calls.push({ name: org.name, domain: org.domain });
    if (Array.isArray(results)) return results[Math.min(calls.length - 1, results.length - 1)];
    return results;
  }) as OrchestrationDeps["matchOrg"];

// ── the match pass ───────────────────────────────────────────────────────────

test("one organization is resolved ONCE however many of its people were found", async () => {
  // A state search returns many people per rooftop. Matching per person would
  // hammer the database and, for an unmatched organization, race itself into
  // creating several rooftops for one dealership.
  const store = newStore({
    candidates: [
      cand({ id: "c1", apolloPersonId: "p1" }),
      cand({ id: "c2", apolloPersonId: "p2" }),
      cand({ id: "c3", apolloPersonId: "p3" }),
    ],
  });
  const calls: Array<{ name: string | null; domain: string | null }> = [];
  const hist = await resolveCandidateRooftops("ps_run", {
    prisma: fakePrisma(store),
    matchOrg: matchFake(match(), calls),
  });

  assert.equal(calls.length, 1, "one Apollo organization → one match call");
  assert.equal(hist.processed, 3);
  assert.equal(hist.organizations, 1);
  assert.equal(hist.strongMatch, 3, "every person of a strongly matched org is spendable");
  for (const c of store.candidates) {
    assert.equal(c.rooftopId, "rt_1");
    assert.equal(c.matchMethod, "website_host");
    assert.equal(c.matchConfidence, "high");
  }
});

test("the histogram separates strong links from created, unmatchable and ambiguous ones", async () => {
  const store = newStore({
    candidates: [
      cand({ id: "c1", apolloPersonId: "p1", apolloOrganizationId: "o1" }),
      cand({ id: "c2", apolloPersonId: "p2", apolloOrganizationId: "o2" }),
      cand({ id: "c3", apolloPersonId: "p3", apolloOrganizationId: "o3" }),
      cand({ id: "c4", apolloPersonId: "p4", apolloOrganizationId: "o4" }),
    ],
  });
  const hist = await resolveCandidateRooftops("ps_run", {
    prisma: fakePrisma(store),
    matchOrg: matchFake([
      match({ method: "website_host", confidence: "high" }),
      match({ rooftopId: "rt_new", method: "created", confidence: "low", created: true }),
      match({ rooftopId: null, method: "unmatchable", confidence: "low" }),
      match({ rooftopId: "rt_2", method: "phone", confidence: "low", ambiguous: true, candidateCount: 3 }),
    ]),
  });

  assert.equal(hist.processed, 4);
  assert.equal(hist.organizations, 4);
  // Only the first is spendable: created is an assertion not a confirmation,
  // unmatchable has no link at all, and ambiguity demotes to low.
  assert.equal(hist.strongMatch, 1);
  assert.equal(hist.strongMatchRate, 0.25);
  assert.equal(hist.ambiguous, 1);
  assert.equal(hist.byMethod.website_host, 1);
  assert.equal(hist.byMethod.created, 1);
  assert.equal(hist.byMethod.unmatchable, 1);
  assert.equal(hist.byMethod.phone, 1);
  assert.deepEqual(hist.byConfidence, { high: 1, medium: 0, low: 3 });
});

test("an unmatchable organization still RECORDS its verdict on the candidate", async () => {
  const store = newStore({ candidates: [cand()] });
  await resolveCandidateRooftops("ps_run", {
    prisma: fakePrisma(store),
    matchOrg: matchFake(match({ rooftopId: null, method: "unmatchable", confidence: "low" })),
  });
  assert.equal(store.candidates[0].rooftopId, null);
  assert.equal(store.candidates[0].matchMethod, "unmatchable", "a finding, not a gap to re-derive");
  assert.equal(store.candidates[0].matchConfidence, "low");
});

test("one candidate that will not write does not abandon the rest of a free pass", async () => {
  const store = newStore({
    candidates: [cand({ id: "c1", apolloPersonId: "p1" }), cand({ id: "c2", apolloPersonId: "p2" })],
    failCandidateUpdate: new Set(["c1"]),
  });
  const hist = await resolveCandidateRooftops("ps_run", {
    prisma: fakePrisma(store),
    matchOrg: matchFake(match()),
  });
  assert.equal(hist.processed, 2);
  assert.equal(store.candidates[1].rooftopId, "rt_1", "the second row still resolved");
});

test("a skipped search runs no match pass and reports an empty histogram", async () => {
  const store = newStore({ candidates: [cand()] });
  const skipped: PeopleSearchResult = {
    skipped: true,
    pagesFetched: 0,
    persisted: 0,
    totalEntries: 0,
    searchRunKey: "ps_x",
  };
  let matchCalls = 0;
  const r = await runPeopleSearchAndMatch(
    { organizationLocations: ["Texas, US"] },
    {
      prisma: fakePrisma(store),
      search: (async () => skipped) as OrchestrationDeps["search"],
      matchOrg: (async () => {
        matchCalls++;
        return match();
      }) as OrchestrationDeps["matchOrg"],
    },
  );
  assert.equal(r.search.skipped, true);
  assert.equal(matchCalls, 0, "nothing was persisted, so there is nothing to resolve");
  assert.equal(r.match.processed, 0);
});

test("a failed match pass reports the error WITHOUT discarding a good free search", async () => {
  const store = newStore({ candidates: [cand()] });
  const prisma = fakePrisma(store);
  const broken = {
    ...prisma,
    apolloPersonCandidate: {
      ...(prisma as unknown as { apolloPersonCandidate: object }).apolloPersonCandidate,
      findMany: async () => {
        throw new Error("candidate scan failed");
      },
    },
  } as unknown as PrismaClient;

  const r = await runPeopleSearchAndMatch(
    { organizationLocations: ["Texas, US"] },
    {
      prisma: broken,
      search: (async () => ({
        skipped: false,
        pagesFetched: 2,
        persisted: 140,
        totalEntries: 140,
        searchRunKey: "ps_run",
      })) as OrchestrationDeps["search"],
      matchOrg: matchFake(match()),
    },
  );
  assert.equal(r.search.persisted, 140, "the search result stands on its own");
  assert.equal(r.matchError, "candidate scan failed");
});

// ── enrichment dependency implementations ────────────────────────────────────

test("candidate selection excludes ENRICHED and the async-reveal states", async () => {
  const store = newStore({
    candidates: [
      cand({ id: "c1", apolloPersonId: "p1", enrichmentStatus: "NEW" }),
      cand({ id: "c2", apolloPersonId: "p2", enrichmentStatus: "FAILED" }),
      cand({ id: "c3", apolloPersonId: "p3", enrichmentStatus: "ENRICHED" }),
      cand({ id: "c4", apolloPersonId: "p4", enrichmentStatus: "PENDING_REVEAL" }),
      cand({ id: "c5", apolloPersonId: "p5", enrichmentStatus: "UNREACHABLE" }),
    ],
  });
  const rows = await selectEnrichmentCandidates({ prisma: fakePrisma(store) });
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    ["c1", "c2", "c5"],
    "ENRICHED is already paid for; PENDING_REVEAL belongs to the async drain",
  );
});

test("priority tier comes from the rooftop's live prospect demand", async () => {
  const store = newStore({
    candidates: [
      cand({ id: "c1", apolloPersonId: "p1", rooftopId: "rt_opp" }),
      cand({ id: "c2", apolloPersonId: "p2", rooftopId: "rt_scripted" }),
      cand({ id: "c3", apolloPersonId: "p3", rooftopId: "rt_scored" }),
      cand({ id: "c4", apolloPersonId: "p4", rooftopId: "rt_plain" }),
      cand({ id: "c5", apolloPersonId: "p5", rooftopId: null }),
    ],
    prospects: [
      { rooftopId: "rt_opp", status: "DISCOVERED", buyerOppId: "opp_1", searchScore: null },
      { rooftopId: "rt_scripted", status: "SCRIPTED", buyerOppId: null, searchScore: null },
      { rooftopId: "rt_scored", status: "DISCOVERED", buyerOppId: null, searchScore: 0.8 },
      { rooftopId: "rt_plain", status: "DISCOVERED", buyerOppId: null, searchScore: null },
      // A dead prospect with a buyer opportunity is NOT live demand and must not
      // pull its rooftop to the front of a paid queue.
      { rooftopId: "rt_plain", status: "DEAD", buyerOppId: "opp_dead", searchScore: null },
    ],
  });
  const rows = await selectEnrichmentCandidates({ prisma: fakePrisma(store) });
  const tier = (id: string) => rows.find((r) => r.id === id)?.priorityTier;
  assert.equal(tier("c1"), 1);
  assert.equal(tier("c2"), 2);
  assert.equal(tier("c3"), 3);
  assert.equal(tier("c4"), 4, "a dead prospect's opportunity must not promote the rooftop");
  assert.equal(tier("c5"), 4, "no rooftop → lowest priority");
});

test("a person we already hold FRESH contact detail for is never re-bought", async () => {
  const base = {
    id: "prof_1",
    rooftopId: "rt_1",
    name: null,
    nameKey: null,
    title: null,
    emailKey: null,
    phone: null,
    phoneKey: null,
    emailVerificationStatus: null,
    apolloOrganizationId: null,
    dncStatus: null,
    dncCheckedAt: null,
    phoneType: null,
    linkedinUrl: null,
  };
  const store = newStore({
    profiles: [
      { ...base, id: "prof_fresh", apolloPersonId: "fresh", email: "a@d.test", apolloLastSyncedAt: new Date(NOW.getTime() - 10 * DAY) },
      { ...base, id: "prof_stale", apolloPersonId: "stale", email: "b@d.test", apolloLastSyncedAt: new Date(NOW.getTime() - 200 * DAY) },
      { ...base, id: "prof_empty", apolloPersonId: "empty", email: null, apolloLastSyncedAt: new Date(NOW.getTime() - 10 * DAY) },
    ] as ProfileRow[],
  });
  const deps = { prisma: fakePrisma(store), now: NOW };

  assert.equal(await isPersonAlreadyEnriched("fresh", deps), true);
  assert.equal(await isPersonAlreadyEnriched("stale", deps), false, "past the staleness window it may refresh");
  assert.equal(
    await isPersonAlreadyEnriched("empty", deps),
    false,
    "a recorded Apollo miss is not held contact detail",
  );
  assert.equal(await isPersonAlreadyEnriched("unknown", deps), false);
});

// ── persistence ──────────────────────────────────────────────────────────────

const revealed = (over: Record<string, unknown> = {}) => ({
  rooftopId: "rt_1",
  apolloPersonId: "p1",
  email: "jordan@roundrocktoyota.com",
  phone: null,
  dncStatus: null,
  dncCheckedAt: null,
  phoneType: null,
  apolloLastSyncedAt: NOW,
  ...over,
});

test("a revealed contact is written with the Apollo provenance and the person claim", async () => {
  const store = newStore({ candidates: [cand()] });
  await persistApolloContact(revealed(), { prisma: fakePrisma(store), now: NOW });

  assert.equal(store.profiles.length, 1);
  const p = store.profiles[0];
  assert.equal(p.email, "jordan@roundrocktoyota.com");
  assert.equal(p.emailVerificationStatus, "VERIFIED", "same label the contact backfill writes");
  assert.equal(p.apolloPersonId, "p1", "the spend idempotency key is claimed");
  assert.equal(p.apolloOrganizationId, "org1");
  assert.deepEqual(p.apolloLastSyncedAt, NOW);
  // Apollo's own rendering of an unrevealed surname — stored, never invented.
  assert.equal(p.name, "Jordan R.");
});

test("a second reveal of the same person UPDATES its profile instead of duplicating it", async () => {
  const store = newStore({ candidates: [cand()] });
  const deps = { prisma: fakePrisma(store), now: NOW };
  await persistApolloContact(revealed(), deps);
  await persistApolloContact(revealed({ dncStatus: "not_found", phoneType: "corporate_phone", dncCheckedAt: NOW }), deps);

  assert.equal(store.profiles.length, 1, "apolloPersonId is unique — one person, one profile");
  assert.equal(store.profiles[0].dncStatus, "not_found");
  assert.equal(store.profiles[0].phoneType, "corporate_phone");
});

test("the DNC verdict is stored VERBATIM — 'pending' is never rewritten as a clearance", async () => {
  const store = newStore({ candidates: [cand()] });
  await persistApolloContact(revealed({ dncStatus: "pending", dncCheckedAt: NOW }), {
    prisma: fakePrisma(store),
    now: NOW,
  });
  assert.equal(store.profiles[0].dncStatus, "pending");
});

test("an Apollo miss with nothing to file writes no profile at all", async () => {
  // No email, no phone, and a candidate carrying no name — there is no identity
  // key, so a row would record nothing but its own existence.
  const store = newStore({
    candidates: [cand({ firstName: null, lastNameObfuscated: null, title: null })],
  });
  await persistApolloContact(revealed({ email: null, phone: null }), { prisma: fakePrisma(store), now: NOW });
  assert.equal(store.profiles.length, 0);
});

test("a profile already claimed by another Apollo person is never stolen", async () => {
  // apolloPersonId is @unique: reassigning it would violate the index and destroy
  // the other person's spend guard.
  const store = newStore({
    candidates: [cand({ id: "c2", apolloPersonId: "p2", firstName: "Jordan", lastNameObfuscated: "R." })],
    profiles: [
      {
        id: "prof_1",
        rooftopId: "rt_1",
        name: "Jordan R.",
        nameKey: "jordan r",
        title: null,
        email: null,
        emailKey: null,
        phone: null,
        phoneKey: null,
        emailVerificationStatus: null,
        apolloPersonId: "p_other",
        apolloOrganizationId: null,
        apolloLastSyncedAt: null,
        dncStatus: null,
        dncCheckedAt: null,
        phoneType: null,
        linkedinUrl: null,
      },
    ],
  });
  await persistApolloContact(revealed({ apolloPersonId: "p2", email: null, phone: null }), {
    prisma: fakePrisma(store),
    now: NOW,
  });
  assert.equal(store.profiles[0].apolloPersonId, "p_other", "the existing claim survives");
});

test("a failed contact write NEVER throws and leaves the loss visible on the candidate", async () => {
  // runEnrichment does not guard persistContact. An exception here would escape
  // the run loop and skip persistRun — credits spent, no audit row.
  const store = newStore({ candidates: [cand()], failProfileUpdate: new Set(["prof_1"]) });
  await persistApolloContact(revealed(), { prisma: fakePrisma(store), now: NOW });

  assert.match(
    String(store.candidates[0].enrichmentError),
    /contact persist failed/,
    "the failure is recorded in the database, not only in a log line",
  );
});

test("candidate status writes are whitelisted and never throw", async () => {
  const store = newStore({ candidates: [cand()] });
  const prisma = fakePrisma(store);
  await updateEnrichmentCandidate(
    "c1",
    { enrichmentStatus: "ENRICHED", lastSyncedAt: NOW, somethingPrismaWouldReject: true },
    { prisma },
  );
  assert.equal(store.candidates[0].enrichmentStatus, "ENRICHED");
  assert.deepEqual(store.candidates[0].lastSyncedAt, NOW);
  assert.equal(
    (store.candidates[0] as unknown as Record<string, unknown>).somethingPrismaWouldReject,
    undefined,
    "an unknown key must not reach Prisma and throw out of the run loop",
  );

  // A row that does not exist is a warning, not an exception.
  await updateEnrichmentCandidate("missing", { enrichmentStatus: "FAILED" }, { prisma });
});

test("the run record is written for an aborted run too, and its own failure is contained", async () => {
  const store = newStore();
  await persistEnrichmentRun(
    {
      mode: "execute",
      maxCredits: 25,
      candidateCount: 4,
      creditsSpent: 3,
      status: "ABORTED_CAP",
      abortReason: "reached the credit cap",
      finishedAt: NOW,
      startedBy: "ops@autolenis.com",
      strayKey: "ignored",
    },
    { prisma: fakePrisma(store) },
  );
  assert.equal(store.runs.length, 1);
  assert.equal(store.runs[0].status, "ABORTED_CAP");
  assert.equal(store.runs[0].creditsSpent, 3);
  assert.equal(store.runs[0].strayKey, undefined);

  const broken = {
    apolloEnrichmentRun: {
      create: async () => {
        throw new Error("audit table unavailable");
      },
    },
  } as unknown as PrismaClient;
  await persistEnrichmentRun({ mode: "preview", status: "COMPLETED" }, { prisma: broken });
});

test("the strong-match rule this module reports MATCHES what the job will actually spend on", async () => {
  // Two statements of one rule: STRONG_MATCH_CONFIDENCES/WEAK_MATCH_METHODS here,
  // and isStrongMatch() inside apollo-enrichment-job (private, different shape).
  // If they drift, the coverage page promises a spendable pool the job refuses —
  // so this runs real candidates through the real previewEnrichment and asserts
  // the counts agree.
  const shapes: Array<{ method: string; confidence: string; rooftopId: string | null }> = [
    { method: "website_host", confidence: "high", rooftopId: "rt_1" },
    { method: "name_zip", confidence: "high", rooftopId: "rt_2" },
    { method: "name_city_state", confidence: "medium", rooftopId: "rt_3" },
    { method: "phone", confidence: "medium", rooftopId: "rt_4" },
    { method: "phone", confidence: "low", rooftopId: "rt_5" }, // ambiguity demoted it
    { method: "created", confidence: "low", rooftopId: "rt_6" },
    { method: "unmatchable", confidence: "low", rooftopId: null },
    { method: "website_host", confidence: "high", rooftopId: null }, // no link at all
  ];
  const store = newStore({
    candidates: shapes.map((s, i) =>
      cand({
        id: `c${i}`,
        apolloPersonId: `p${i}`,
        rooftopId: s.rooftopId,
        matchMethod: s.method,
        matchConfidence: s.confidence,
      }),
    ),
  });

  const expectedStrong = shapes.filter(
    (s) =>
      s.rooftopId !== null &&
      !(WEAK_MATCH_METHODS as readonly string[]).includes(s.method) &&
      (STRONG_MATCH_CONFIDENCES as readonly string[]).includes(s.confidence),
  ).length;
  assert.equal(expectedStrong, 4, "sanity: the fixture covers both sides of the rule");

  const prisma = fakePrisma(store);
  const preview = await previewEnrichment(
    { maxCredits: 1000 },
    {
      prisma,
      now: NOW,
      waterfallEnabled: () => false,
      ledgerRemaining: async () => 1000,
      selectCandidates: () => selectEnrichmentCandidates({ prisma, now: NOW }),
      persistRun: async () => {},
    },
  );

  assert.equal(
    preview.candidateCount,
    expectedStrong,
    "the job spends on exactly the candidates this module counts as strong",
  );
});
