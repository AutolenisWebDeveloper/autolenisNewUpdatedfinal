// E-sign executed-artifact reconciliation cron (/api/cron/esign-artifact-reconcile).
//
// This cron failed 100% of the time in production: reconcileSignedContracts filters
// on executed_document_key and confirmations_sent_at, columns that migrations
// 20261014 + 20261015 add but that are DELIBERATELY UNAPPLIED (owner-gated pending
// attorney review), so every run was a 42703 and withCronRun recorded FAILED.
//
// These tests pin the fix: with ESIGN_EXECUTED_ARTIFACT_ENABLED off (the default)
// the sweep is not attempted, the run completes rather than failing, and the
// response is TRUTHFUL — it reports the skip and its reason and never presents
// zero counters as a successful sweep.
//
// Run: npx tsx --test --experimental-test-module-mocks \
//   "app/api/cron/__tests__/esign-artifact-reconcile-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// The signing service transitively imports modules marked `server-only`; neutralize
// it so the REAL service (and therefore the real gate) can be loaded under node:test.
mock.module("server-only", { namedExports: {} });

// Records what withCronRun would have written to CronJobLog.
let cronOutcome: { name: string; status: "COMPLETED" | "FAILED"; result?: unknown; error?: unknown } | null = null;
let reconcileCalls = 0;
let envelopeQueries = 0;

// The real service, unmocked except for its data access, so the gate is exercised
// for real rather than stubbed. Any Prisma read here means the gate leaked.
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      eSignEnvelope: {
        findMany: async () => {
          envelopeQueries += 1;
          // Mirrors production: naming a column the database does not have is a
          // hard Postgres error, not an empty result.
          throw new Error(
            'The column `e_sign_envelopes.executed_document_key` does not exist in the current database.',
          );
        },
      },
    },
  },
});

// Replicate withCronRun's real contract AND capture the status it would persist:
// work throws → FAILED; work returns → COMPLETED.
mock.module("@/lib/services/monitoring/cron-monitor.service", {
  namedExports: {
    withCronRun: async (name: string, work: () => Promise<unknown>) => {
      try {
        const result = await work();
        cronOutcome = { name, status: "COMPLETED", result };
        return { ok: true, result };
      } catch (error) {
        cronOutcome = { name, status: "FAILED", error };
        return { ok: false, error };
      }
    },
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});

async function loadGET() {
  return (await import("@/app/api/cron/esign-artifact-reconcile/route")).GET;
}

const AUTH = { authorization: "Bearer test-secret" };
const req = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost/api/cron/esign-artifact-reconcile", { headers });

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED; // default: OFF
  cronOutcome = null;
  reconcileCalls = 0;
  envelopeQueries = 0;
});

test("switch off (unset): returns 200 and never touches the ungated schema", async () => {
  const GET = await loadGET();
  const res = await GET(req(AUTH));

  assert.equal(res.status, 200);
  assert.equal(envelopeQueries, 0, "the gate must short-circuit BEFORE any e_sign_envelopes query");
});

test("switch off: withCronRun records COMPLETED, not FAILED", async () => {
  const GET = await loadGET();
  await GET(req(AUTH));

  assert.equal(cronOutcome?.name, "esign-artifact-reconcile");
  assert.equal(cronOutcome?.status, "COMPLETED", "a gated skip is not a cron failure");
  assert.equal(cronOutcome?.error, undefined);
});

test("switch off: the response is a truthful skip, not a false success", async () => {
  const GET = await loadGET();
  const res = await GET(req(AUTH));
  const body = (await res.json()) as Record<string, unknown>;

  // It must SAY it skipped, and say why — a bare `success: true` with zero
  // counters would read as "swept everything, nothing to do", which is a lie.
  assert.equal(body.skipped, true, "the response must declare that it skipped");
  assert.equal(body.reason, "executed_artifact_disabled", "the skip must name its reason");

  // Counters must be zero: claiming finalized work that never happened is the
  // precise failure mode this test exists to prevent.
  assert.equal(body.scanned, 0);
  assert.equal(body.finalized, 0);
  assert.equal(body.pending, 0);
  assert.equal(body.stuck, 0);
});

test("switch off: repeated runs stay clean and idempotent", async () => {
  const GET = await loadGET();
  for (let i = 0; i < 3; i++) {
    const res = await GET(req(AUTH));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { skipped?: boolean }).skipped, true);
  }
  assert.equal(envelopeQueries, 0);
  assert.equal(cronOutcome?.status, "COMPLETED");
});

test("a value other than the exact string \"true\" leaves the gate closed", async () => {
  const GET = await loadGET();
  for (const value of ["1", "TRUE", "yes", "", "false"]) {
    process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = value;
    const res = await GET(req(AUTH));
    const body = (await res.json()) as { skipped?: boolean };
    assert.equal(body.skipped, true, `"${value}" must not open the gate`);
  }
  assert.equal(envelopeQueries, 0);
});

test("switch ON against an unmigrated database: the failure is reported, never masked", async () => {
  // The gate is a compatibility switch, not an error suppressor. Turned on while
  // the columns are still missing, the cron must fail loudly (500 + FAILED) so the
  // misconfiguration is visible — it must not degrade into a silent green.
  process.env.ESIGN_EXECUTED_ARTIFACT_ENABLED = "true";
  const GET = await loadGET();
  const res = await GET(req(AUTH));

  assert.equal(envelopeQueries, 1, "with the gate open the sweep really runs");
  assert.equal(res.status, 500);
  assert.equal(cronOutcome?.status, "FAILED");
  const body = (await res.json()) as { success?: boolean };
  assert.equal(body.success, false);
});

test("unauthenticated requests are still rejected before any gate logic", async () => {
  const GET = await loadGET();
  const res = await GET(req()); // no bearer token
  assert.equal(res.status, 401);
  assert.equal(cronOutcome, null, "cron auth runs before withCronRun");
  assert.equal(reconcileCalls, 0);
});
