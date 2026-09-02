// Route contract tests for GET /api/cron/inventory-stale-sweep.
//
// Written against the four-month production defect: this cron ran every 30
// minutes, COMPLETED, error null, `deactivated: 0`, while 95 inventory rows sat
// active with last_seen_at up to four months old. Every one was LANE_1 with
// dealer_id NULL, and the cron's `lane: { not: "LANE_1" }` filter could not reach
// them. The regressions below pin the corrected predicate at the route boundary,
// not just in the pure helper.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/cron/__tests__/inventory-stale-sweep-route.test.ts"

import test, { mock, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

interface Call { [k: string]: unknown }

const calls = {
  updateMany: [] as Call[],
  count: [] as Call[],
  findMany: [] as Call[],
  staleRemovalEmails: [] as Call[],
  syncFailureEmails: [] as Call[],
};

let updateManyCount = 0;
let countResult = 0;
let dealerOwnedStaleItems: Array<{ dealerId: string | null; year: number; make: string; model: string }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventoryItem: {
        findMany: async (args: Call) => { calls.findMany.push(args); return dealerOwnedStaleItems; },
        updateMany: async (args: Call) => { calls.updateMany.push(args); return { count: updateManyCount }; },
        count: async (args: Call) => { calls.count.push(args); return countResult; },
      },
      dealer: {
        findMany: async () => [] as unknown[],
        findUnique: async () => null,
      },
      cronJobLog: {
        create: async () => ({ id: "cron_1", cronName: "inventory-stale-sweep", status: "RUNNING" }),
        findUnique: async () => ({ id: "cron_1", cronName: "inventory-stale-sweep", status: "RUNNING", startedAt: new Date() }),
        update: async () => ({ id: "cron_1" }),
      },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerStaleListingRemovalEmail: async (args: Call) => { calls.staleRemovalEmails.push(args); },
    sendDealerInventorySyncFailureEmail: async (args: Call) => { calls.syncFailureEmails.push(args); },
  },
});

async function loadGET() {
  const mod = await import("@/app/api/cron/inventory-stale-sweep/route");
  return mod.GET;
}

function authed(url = "http://localhost/api/cron/inventory-stale-sweep") {
  return new NextRequest(url, { headers: { authorization: "Bearer test-secret" } });
}

beforeEach(() => {
  calls.updateMany = []; calls.count = []; calls.findMany = [];
  calls.staleRemovalEmails = []; calls.syncFailureEmails = [];
  updateManyCount = 0;
  countResult = 0;
  dealerOwnedStaleItems = [];
  process.env.CRON_SECRET = "test-secret";
});

describe("auth", () => {
  test("rejects an unauthenticated request", async () => {
    const GET = await loadGET();
    const res = await GET(new NextRequest("http://localhost/api/cron/inventory-stale-sweep"));
    assert.equal(res.status, 401);
    assert.equal(calls.updateMany.length, 0, "nothing may be deactivated without cron auth");
  });
});

describe("the corrected sweep predicate", () => {
  test("REGRESSION: no bare `lane != LANE_1` filter — that exempted 95 dealer-less rows", async () => {
    const GET = await loadGET();
    await GET(authed());

    assert.equal(calls.updateMany.length, 1);
    const where = JSON.stringify((calls.updateMany[0] as { where: unknown }).where);
    assert.ok(
      !/"lane":\{"not":"LANE_1"\}/.test(where),
      `the sweep must not exempt a whole lane; got ${where}`,
    );
  });

  test("REGRESSION: the exemption is keyed on dealerId and addedByAdminId", async () => {
    const GET = await loadGET();
    await GET(authed());

    const where = JSON.stringify((calls.updateMany[0] as { where: unknown }).where);
    assert.ok(where.includes("dealerId"), "dealer-managed rows must be exempted by their dealer link");
    assert.ok(where.includes("addedByAdminId"), "admin-curated rows must stay exempt");
  });

  test("REGRESSION: rows with NULL lastSeenAt are reachable via createdAt", async () => {
    const GET = await loadGET();
    await GET(authed());

    const where = JSON.stringify((calls.updateMany[0] as { where: unknown }).where);
    assert.ok(
      where.includes("createdAt"),
      "`lastSeenAt < cutoff` is UNKNOWN for NULL; without a createdAt arm such a row never ages out",
    );
  });

  test("REGRESSION: no unreachable dealer-removal snapshot is issued", async () => {
    // The old cron snapshotted `stale AND dealerId IS NOT NULL` to email dealers
    // whose listings it removed. Under the corrected exemption a row with a dealerId
    // is never swept, so that query is `dealer_id IS NULL AND dealer_id IS NOT NULL`
    // — provably empty, feeding an email that could never send. It is gone.
    const GET = await loadGET();
    await GET(authed());

    const inventorySnapshots = calls.findMany.filter((c) => {
      const j = JSON.stringify(c);
      return j.includes("lastSeenAt") || j.includes("addedByAdminId");
    });
    assert.equal(inventorySnapshots.length, 0, "no inventory snapshot query should remain");
    assert.equal(calls.staleRemovalEmails.length, 0);
  });

  test("only active rows are swept", async () => {
    const GET = await loadGET();
    await GET(authed());
    const where = (calls.updateMany[0] as { where: { isActive?: boolean } }).where;
    assert.equal(where.isActive, true);
  });
});

describe("reporting", () => {
  test("reports the number actually deactivated", async () => {
    updateManyCount = 95;
    const GET = await loadGET();
    const res = await GET(authed());
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.deactivated, 95);
    assert.equal(body.data.dryRun, false);
  });

  test("AutoLenis no longer auto-deactivates dealer inventory, so no removal email fires", async () => {
    updateManyCount = 1;
    const GET = await loadGET();
    await GET(authed());

    assert.equal(calls.staleRemovalEmails.length, 0);
    const where = JSON.stringify((calls.updateMany[0] as { where: unknown }).where);
    assert.ok(where.includes("dealerId"), "dealer rows are excluded by the predicate itself");
  });
});

describe("dryRun", () => {
  test("writes nothing and reports what WOULD be deactivated", async () => {
    countResult = 95;
    const GET = await loadGET();
    const res = await GET(authed("http://localhost/api/cron/inventory-stale-sweep?dryRun=1"));
    const body = await res.json();

    assert.equal(calls.updateMany.length, 0, "a dry run must not mutate a single row");
    assert.equal(calls.count.length, 1);
    assert.equal(body.data.dryRun, true);
    assert.equal(body.data.deactivated, 95);
  });

  test("dryRun counts with the SAME predicate the real sweep would mutate with", async () => {
    countResult = 3;
    const GET = await loadGET();
    await GET(authed("http://localhost/api/cron/inventory-stale-sweep?dryRun=1"));

    const countWhere = JSON.stringify((calls.count[0] as { where: unknown }).where);
    assert.ok(!/"lane":\{"not":"LANE_1"\}/.test(countWhere));
    assert.ok(countWhere.includes("addedByAdminId"), "a preview that previews a different query is worthless");
  });

  test("dryRun sends no email of any kind", async () => {
    countResult = 1;
    const GET = await loadGET();
    await GET(authed("http://localhost/api/cron/inventory-stale-sweep?dryRun=1"));

    assert.equal(calls.staleRemovalEmails.length, 0, "a preview must have no outward-facing side effects");
    assert.equal(calls.syncFailureEmails.length, 0);
  });
});
