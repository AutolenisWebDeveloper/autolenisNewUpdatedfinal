// S2 — intake-reconcile cron. Mirrors the auction-close F-001 reconciler.
//
// Pins: cron auth; the stuck-detection query uses intakeProcessedAt IS NULL (so a
// completed intake, and a legit zero-dealer coverage-gap intake that still got
// stamped, are BOTH excluded — the whole reason S1 added intakeProcessedAt rather
// than inferring from marketEnrichedAt/prospect presence); bounded take:100
// oldest-first; and one autolenis/intake.process re-emit per stuck row (safe
// because the worker is idempotent and the S1 discovery guard blocks duplicate
// prospects on re-drive).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks "app/api/cron/__tests__/intake-reconcile-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let findManyArgs: Record<string, unknown> | null = null;
let stuckRows: Array<{ id: string }> = [];
const sent: Array<{ name: string; data: Record<string, unknown> }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        findMany: async (args: Record<string, unknown>) => {
          findManyArgs = args;
          return stuckRows;
        },
      },
    },
  },
});

mock.module("@/lib/inngest/client", {
  namedExports: {
    inngest: {
      send: async (evt: { name: string; data: Record<string, unknown> }) => {
        sent.push(evt);
        return { ids: ["evt"] };
      },
    },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/intake-reconcile/route");
  return mod.GET;
}

function req(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/cron/intake-reconcile", { headers });
}

beforeEach(() => {
  findManyArgs = null;
  stuckRows = [];
  sent.length = 0;
  process.env.CRON_SECRET = "test-secret";
});

test("rejects unauthorized requests without touching the DB", async () => {
  const GET = await loadGET();
  const res = await GET(req());
  assert.equal(res.status, 401);
  assert.equal(findManyArgs, null, "no query on an unauthorized request");
  assert.equal(sent.length, 0);
});

test("rejects a spoofed x-vercel-cron header; accepts the bearer secret", async () => {
  const GET = await loadGET();
  assert.equal((await GET(req({ "x-vercel-cron": "1" }))).status, 401);
  assert.equal((await GET(req({ authorization: "Bearer test-secret" }))).status, 200);
});

test("query targets intakeProcessedAt IS NULL + active VR status, bounded oldest-first", async () => {
  const GET = await loadGET();
  await GET(req({ authorization: "Bearer test-secret" }));
  assert.ok(findManyArgs, "findMany was called");
  const where = findManyArgs!.where as Record<string, unknown>;

  // The unambiguous "not done" marker — excludes completed AND coverage-gap rows.
  assert.equal(where.intakeProcessedAt, null);
  // Staleness threshold, not a trailing window.
  assert.ok((where.createdAt as { lt: Date }).lt instanceof Date);
  // Covers BOTH stuck cases: linked VR still sourcing OR no VR at all.
  const or = where.OR as Array<Record<string, unknown>>;
  const sourcing = or.find((c) => (c.vehicleRequests as { some?: unknown }).some);
  const noVr = or.find((c) => (c.vehicleRequests as { none?: unknown }).none);
  assert.deepEqual(
    (sourcing!.vehicleRequests as { some: { status: { in: string[] } } }).some.status.in,
    ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"],
  );
  assert.deepEqual((noVr!.vehicleRequests as { none: unknown }).none, {});
  // Must NOT infer stuckness from enrichment/prospect presence (S1 decision).
  assert.equal("marketEnrichedAt" in where, false);
  assert.equal("dealerProspects" in where, false);

  assert.equal(findManyArgs!.take, 100);
  assert.deepEqual(findManyArgs!.orderBy, { createdAt: "asc" });
});

test("re-emits exactly one intake.process event per stuck row", async () => {
  stuckRows = [{ id: "opp_a" }, { id: "opp_b" }];
  const GET = await loadGET();
  const res = await GET(req({ authorization: "Bearer test-secret" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.found, 2);
  assert.equal(body.data.reEmitted, 2);

  const intakeEvents = sent.filter((e) => e.name === "autolenis/intake.process");
  assert.equal(intakeEvents.length, 2);
  assert.deepEqual(intakeEvents.map((e) => e.data.buyerOpportunityId).sort(), ["opp_a", "opp_b"]);
});

test("no stuck rows → nothing re-emitted", async () => {
  stuckRows = [];
  const GET = await loadGET();
  const res = await GET(req({ authorization: "Bearer test-secret" }));
  const body = await res.json();
  assert.equal(body.data.found, 0);
  assert.equal(body.data.reEmitted, 0);
  assert.equal(sent.length, 0);
});
