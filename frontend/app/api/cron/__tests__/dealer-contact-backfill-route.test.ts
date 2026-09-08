// dealer-contact-backfill cron — a GATED run is a HEALTHY run.
//
// APOLLO_REVEAL_ENABLED is already "true" in production, and since the
// API-contract batch an attempt bills for the organization resolution too, so
// the daily cron would spend unattended the moment that deploys. The
// APOLLO_BACKFILL_ENABLED switch keeps Phase 1 off until armed. What this test
// holds: with the switch off the REAL service still runs Phase 0, never scans a
// gap rooftop, never reads the ledger, and the route reports a completed run —
// the dead-cron monitor must not read a deliberately gated job as OVERDUE.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/cron/__tests__/dealer-contact-backfill-route.test.ts

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const cronLog = { create: [] as Array<Record<string, unknown>>, update: [] as Array<Record<string, unknown>> };
const reads = { dealer: 0, prospect: 0, rooftopScan: 0, ledger: 0 };

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      cronJobLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.create.push(data);
          return { id: "log_1", startedAt: new Date() };
        },
        findUnique: async () => ({ id: "log_1", startedAt: new Date(Date.now() - 500) }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          cronLog.update.push(data);
          return { id: "log_1" };
        },
      },
      // Phase 0 population — empty, but the reads must happen.
      dealer: { findMany: async () => { reads.dealer++; return []; } },
      dealerProspect: { findMany: async () => { reads.prospect++; return []; } },
      // Phase 1 — reaching any of these while gated is the defect under test.
      dealerRooftop: {
        findMany: async () => { reads.rooftopScan++; throw new Error("Phase 1 scanned rooftops while gated"); },
        count: async () => { reads.rooftopScan++; throw new Error("Phase 1 counted rooftops while gated"); },
      },
      apolloCreditLedger: {
        findUnique: async () => { reads.ledger++; throw new Error("the ledger was read while gated"); },
      },
      apolloReveal: {
        findMany: async () => { throw new Error("cycle attempts were read while gated"); },
      },
    },
  },
});

const orig = {
  key: process.env.APOLLO_API_KEY,
  reveal: process.env.APOLLO_REVEAL_ENABLED,
  backfill: process.env.APOLLO_BACKFILL_ENABLED,
};

function cronReq() {
  return new NextRequest("http://localhost/api/cron/dealer-contact-backfill", {
    headers: { authorization: "Bearer test-secret" },
  });
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  process.env.APOLLO_API_KEY = "test-key";
  process.env.APOLLO_REVEAL_ENABLED = "true"; // as in production
  delete process.env.APOLLO_BACKFILL_ENABLED; // the default: unattended spend not armed
  cronLog.create = [];
  cronLog.update = [];
  reads.dealer = 0; reads.prospect = 0; reads.rooftopScan = 0; reads.ledger = 0;
});
afterEach(() => {
  for (const [k, v] of [["APOLLO_API_KEY", orig.key], ["APOLLO_REVEAL_ENABLED", orig.reveal], ["APOLLO_BACKFILL_ENABLED", orig.backfill]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("with the switch off, the cron completes HEALTHY: Phase 0 ran, Phase 1 gated, nothing scanned or drawn", async () => {
  const { GET } = await import("@/app/api/cron/dealer-contact-backfill/route");
  const res = await GET(cronReq());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };

  assert.equal(body.success, true);
  assert.equal(body.data.enabled, true, "the paid tier is on and is reported so");
  assert.equal(body.data.phase1Gated, true);
  assert.equal(body.data.attempted, 0);
  assert.equal(body.data.candidates, 0);

  assert.ok(reads.dealer >= 1 && reads.prospect >= 1, "Phase 0 still ran");
  assert.equal(reads.rooftopScan, 0, "no gap rooftop was scanned");
  assert.equal(reads.ledger, 0, "the ledger was never read — nothing could be drawn");

  // The monitor's record: one RUNNING create, one COMPLETED update. A gated run
  // must never look like a failed or missing one.
  assert.equal(cronLog.create.length, 1);
  assert.equal(cronLog.create[0].cronName, "dealer-contact-backfill");
  assert.equal(cronLog.update.length, 1);
  assert.equal(cronLog.update[0].status, "COMPLETED");
  assert.equal((cronLog.update[0].result as { phase1Gated: boolean }).phase1Gated, true, "the gate is visible in the recorded result");
});

test("a wrong cron secret is still refused before anything runs", async () => {
  const { GET } = await import("@/app/api/cron/dealer-contact-backfill/route");
  const res = await GET(new NextRequest("http://localhost/api/cron/dealer-contact-backfill", { headers: { authorization: "Bearer nope" } }));
  assert.notEqual(res.status, 200);
  assert.equal(cronLog.create.length, 0);
  assert.equal(reads.dealer, 0);
});
