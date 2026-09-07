// Apollo API-contract probe — the one-shot live check that proves the corrected
// endpoints from production, since CI cannot reach api.apollo.io.
//
// What is held here: the probe reaches exactly two documented paths and never
// people/match; its rooftop list and spend ceiling are constants; every
// organization resolution draws from the ledger BEFORE the call and refunds only
// the documented free outcome; and the raw envelope comes back verbatim, bounded.
//   npx tsx --test lib/services/dealer-recruitment/__tests__/apollo-contract-probe.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import {
  runApolloContractProbe,
  PROBE_ROOFTOPS,
  PROBE_MAX_CREDITS,
  PROBE_BODY_LIMIT,
  PROBE_ORG_ENDPOINT,
  PROBE_PEOPLE_ENDPOINT,
  type ProbeCall,
  type ProbeDeps,
} from "../apollo-contract-probe.service";
import { ORG_RESOLVE_COST_CREDITS, type ApolloHttpResult, type ApolloRequestInput } from "../apollo.service";

const NOW = new Date("2026-09-07T12:00:00Z");

// The probe draws as consumer "backfill", so the 500-credit live reserve floor
// applies (day 7 of the cycle): a fixture needs a cap ABOVE the floor to have
// any backfill budget at all. 2000 is production's default cycle cap.
interface LedgerRow { cycleKey: string; capCredits: number; spentCredits: number }

function fakePrisma(ledger: LedgerRow, rooftopIds: Record<string, string> = {}): { prisma: PrismaClient; ledger: LedgerRow } {
  const prisma = {
    dealerRooftop: {
      findUnique: async ({ where }: { where: { websiteHost: string } }) =>
        rooftopIds[where.websiteHost] ? { id: rooftopIds[where.websiteHost] } : null,
    },
    apolloCreditLedger: {
      findUnique: async ({ where }: { where: { cycleKey: string } }) =>
        where.cycleKey === ledger.cycleKey ? { ...ledger } : null,
      updateMany: async ({ where, data }: { where: { cycleKey: string; spentCredits?: { lte?: number; gte?: number } }; data: { spentCredits: { increment?: number; decrement?: number } } }) => {
        if (where.cycleKey !== ledger.cycleKey) return { count: 0 };
        if (data.spentCredits.increment != null) {
          if (where.spentCredits?.lte != null && ledger.spentCredits > where.spentCredits.lte) return { count: 0 };
          ledger.spentCredits += data.spentCredits.increment;
          return { count: 1 };
        }
        if (data.spentCredits.decrement != null) {
          if (where.spentCredits?.gte != null && ledger.spentCredits < where.spentCredits.gte) return { count: 0 };
          ledger.spentCredits -= data.spentCredits.decrement;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, ledger };
}

interface Seen { path: string; input: ApolloRequestInput; spentAtCall: number }

/** A scripted Apollo: answers per path, recording what it was asked and the ledger state at the moment of the call. */
function scripted(
  ledger: LedgerRow,
  answer: (path: string, input: ApolloRequestInput) => ApolloHttpResult,
): { request: ProbeDeps["request"]; seen: Seen[] } {
  const seen: Seen[] = [];
  const request: ProbeDeps["request"] = async (path, input) => {
    seen.push({ path, input, spentAtCall: ledger.spentCredits });
    return answer(path, input);
  };
  return { request, seen };
}

const orgFound = (id = "o-1"): ApolloHttpResult => ({ kind: "http", status: 200, ok: true, json: { organization: { id, name: "X", primary_domain: "x.test" } } });
const orgMissing: ApolloHttpResult = { kind: "http", status: 200, ok: true, json: { organization: null } };
const people: ApolloHttpResult = { kind: "http", status: 200, ok: true, json: { people: [{ id: "p1", first_name: "A", last_name: "B." }], pagination: { total_entries: 1 } } };

const call = (c: ProbeCall | { skipped: string }): ProbeCall => {
  assert.ok(!("skipped" in c), `expected a call, got skip: ${(c as { skipped: string }).skipped}`);
  return c as ProbeCall;
};

test("the paid tier off → null, nothing asked, nothing drawn", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 });
  const { request, seen } = scripted(ledger, () => orgFound());
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => false, request });
  assert.equal(r, null);
  assert.equal(seen.length, 0);
  assert.equal(ledger.spentCredits, 0);
});

test("the rooftop list and the spend ceiling are constants the caller cannot widen", () => {
  assert.equal(PROBE_ROOFTOPS.length, 3);
  assert.deepEqual(PROBE_ROOFTOPS.map((r) => r.domain), ["bermancdjr.com", "marinocdjr.com", "jackphelancdjr.com"]);
  assert.equal(PROBE_MAX_CREDITS, PROBE_ROOFTOPS.length * ORG_RESOLVE_COST_CREDITS);
  // The function takes no rooftop input at all.
  assert.equal(runApolloContractProbe.length, 1);
});

test("happy path: exactly one org resolution and one people search per rooftop, on the two documented paths, never people/match", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 }, { "bermancdjr.com": "rt-berman" });
  const { request, seen } = scripted(ledger, (path) => (path === PROBE_ORG_ENDPOINT ? orgFound() : people));
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);

  assert.deepEqual(r.endpointsTouched, [PROBE_ORG_ENDPOINT, PROBE_PEOPLE_ENDPOINT].sort());
  assert.equal(seen.some((s) => s.path.includes("people/match")), false, "the reveal is never reached");
  assert.equal(seen.filter((s) => s.path === PROBE_ORG_ENDPOINT).length, 3, "one org resolution per rooftop");
  assert.equal(seen.filter((s) => s.path === PROBE_PEOPLE_ENDPOINT).length, 3, "one people search per rooftop");
  assert.equal(seen.length, 6, "and nothing else");

  assert.equal(r.rooftops.length, 3);
  assert.equal(r.rooftops[0].rooftopId, "rt-berman", "the production row is correlated when it exists");
  assert.equal(r.rooftops[1].rooftopId, null);
  for (const rt of r.rooftops) {
    assert.equal(rt.creditsDrawn, ORG_RESOLVE_COST_CREDITS);
    assert.equal(rt.creditsKept, ORG_RESOLVE_COST_CREDITS, "a hit keeps the credit");
    assert.equal(rt.organizationId, "o-1");
    const org = call(rt.orgResolution);
    assert.equal(org.method, "GET");
    assert.deepEqual(org.request.query, { domain: rt.domain });
    assert.equal(org.request.body, undefined, "enrich is a GET — no body");
    assert.equal(org.status, 200);
    assert.deepEqual(org.envelopeKeys, ["organization"]);
    const ppl = call(rt.peopleSearch);
    assert.equal(ppl.method, "POST");
    assert.deepEqual(ppl.request.body?.organization_ids, ["o-1"]);
    assert.equal(ppl.request.body?.per_page, 3, "a small page keeps the raw envelope readable");
    assert.deepEqual(ppl.envelopeKeys, ["people", "pagination"]);
  }
  assert.equal(r.creditsDrawn, PROBE_MAX_CREDITS);
  assert.equal(r.creditsKept, PROBE_MAX_CREDITS);
  assert.equal(ledger.spentCredits, PROBE_MAX_CREDITS);
});

test("THE DRAW PRECEDES THE CALL: at the moment enrich is called, that rooftop's credit is already in the ledger", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 4 });
  const { request, seen } = scripted(ledger, (path) => (path === PROBE_ORG_ENDPOINT ? orgFound() : people));
  await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  const orgCalls = seen.filter((s) => s.path === PROBE_ORG_ENDPOINT);
  assert.deepEqual(orgCalls.map((s) => s.spentAtCall), [5, 6, 7], "each org call sees its own credit drawn before it runs");
  const peopleCalls = seen.filter((s) => s.path === PROBE_PEOPLE_ENDPOINT);
  assert.deepEqual(peopleCalls.map((s) => s.spentAtCall), [5, 6, 7], "the free people search draws nothing extra");
});

test("a clean 2xx with no organization is the documented free miss: refunded, and the people search is skipped", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 });
  const { request, seen } = scripted(ledger, () => orgMissing);
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);
  assert.equal(r.creditsDrawn, PROBE_MAX_CREDITS, "drawn before each call");
  assert.equal(r.creditsKept, 0, "every miss refunded");
  assert.equal(ledger.spentCredits, 0);
  assert.equal(seen.filter((s) => s.path === PROBE_PEOPLE_ENDPOINT).length, 0, "no organization id → nothing to search");
  for (const rt of r.rooftops) {
    assert.equal(rt.organizationId, null);
    assert.deepEqual(rt.peopleSearch, { skipped: "no organization id resolved" });
    assert.equal(call(rt.orgResolution).status, 200);
  }
});

test("a non-2xx keeps the credit — whether Apollo charged is unknowable, and a wrong path must be loud", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 });
  const { request } = scripted(ledger, () => ({ kind: "http", status: 404, ok: false, json: { error: "not found" } }));
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);
  assert.equal(r.creditsKept, PROBE_MAX_CREDITS);
  assert.equal(ledger.spentCredits, PROBE_MAX_CREDITS);
  const org = call(r.rooftops[0].orgResolution);
  assert.equal(org.status, 404);
  assert.equal(org.ok, false);
  assert.deepEqual(org.body, { error: "not found" }, "the raw envelope is returned whatever the status");
});

test("a transport failure keeps the credit and is reported as such, with no status", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 });
  const { request } = scripted(ledger, () => ({ kind: "transport", error: "timeout" }));
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);
  const org = call(r.rooftops[0].orgResolution);
  assert.equal(org.status, null);
  assert.equal(org.transport, "timeout");
  assert.equal(r.creditsKept, PROBE_MAX_CREDITS);
});

test("no budget: the rooftop is skipped entirely — no call, no draw, and the run still reports it", async () => {
  // Two credits above the backfill floor is enough for two rooftops, not three.
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 502, spentCredits: 0 });
  const { request, seen } = scripted(ledger, (path) => (path === PROBE_ORG_ENDPOINT ? orgFound() : people));
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);
  assert.equal(seen.filter((s) => s.path === PROBE_ORG_ENDPOINT).length, 2);
  assert.equal(r.creditsDrawn, 2);
  const third = r.rooftops[2];
  assert.equal(third.creditsDrawn, 0);
  assert.match((third.orgResolution as { skipped: string }).skipped, /no budget/);
  assert.deepEqual(third.peopleSearch, { skipped: "no organization resolution" });
});

test("an oversized envelope is returned truncated, with its keys still readable", async () => {
  const { prisma, ledger } = fakePrisma({ cycleKey: "2026-09", capCredits: 2000, spentCredits: 0 });
  const huge = { organization: { id: "o-1", description: "x".repeat(PROBE_BODY_LIMIT * 2) } };
  const { request } = scripted(ledger, (path) =>
    path === PROBE_ORG_ENDPOINT ? { kind: "http", status: 200, ok: true, json: huge } : people,
  );
  const r = await runApolloContractProbe({ prisma, now: NOW, enabled: () => true, request });
  assert.ok(r);
  const org = call(r.rooftops[0].orgResolution);
  assert.equal(org.truncated, true);
  assert.equal(typeof org.body, "string");
  assert.equal((org.body as string).length, PROBE_BODY_LIMIT);
  assert.deepEqual(org.envelopeKeys, ["organization"]);
  assert.equal(r.rooftops[0].organizationId, "o-1", "truncation is presentation only — the id was still read");
});
