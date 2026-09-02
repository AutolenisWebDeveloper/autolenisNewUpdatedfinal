// inventory-stale-sweep route — delegation, modes, and the side effects that must survive.
//
// The route used to carry its own copy of the sweep predicate (a second copy lived inside
// runInventorySync), and both had the same defect. It now holds NO predicate of its own.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/cron/__tests__/inventory-stale-sweep-route.test.ts

import test, { mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";

const cronLog = { create: [] as Array<Record<string, unknown>>, update: [] as Array<Record<string, unknown>> };
const itemCalls = { findMany: [] as unknown[], updateMany: [] as unknown[] };
const removalEmails: Array<Record<string, unknown>> = [];
const failureEmails: Array<Record<string, unknown>> = [];
const notifications: Array<Record<string, unknown>> = [];

/** Rows the sweep's SELECT returns. */
let staleRows: Array<Record<string, unknown>> = [];

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
      inventoryItem: {
        findMany: async (args: unknown) => { itemCalls.findMany.push(args); return staleRows; },
        updateMany: async (args: unknown) => { itemCalls.updateMany.push(args); return { count: staleRows.length }; },
        count: async () => 1,
      },
      dealer: {
        findMany: async () => [],
        findUnique: async () => ({ id: "d1", dealershipName: "Metroplex Ford", user: { email: "ops@metroplex.test" } }),
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => { notifications.push(data); return { id: "n1" }; },
      },
    },
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerStaleListingRemovalEmail: async (a: Record<string, unknown>) => { removalEmails.push(a); },
    sendDealerInventorySyncFailureEmail: async (a: Record<string, unknown>) => { failureEmails.push(a); },
  },
});

const origMode = process.env.INVENTORY_STALE_SWEEP_MODE;
const origThreshold = process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS;

function cronReq() {
  return new NextRequest("http://localhost/api/cron/inventory-stale-sweep", {
    headers: { authorization: "Bearer test-secret" },
  });
}

function rows(n: number, withDealer = false) {
  return Array.from({ length: n }, (_, i) => ({
    id: `item_${i}`, lane: "LANE_1", dealerId: withDealer ? "d1" : null,
    lastSeenAt: new Date("2026-06-01"), year: 2021, make: "Honda", model: "Accord",
  }));
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  cronLog.create = []; cronLog.update = [];
  itemCalls.findMany = []; itemCalls.updateMany = [];
  removalEmails.length = 0; failureEmails.length = 0; notifications.length = 0;
  staleRows = [];
  delete process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS;
});
afterEach(() => {
  if (origMode === undefined) delete process.env.INVENTORY_STALE_SWEEP_MODE;
  else process.env.INVENTORY_STALE_SWEEP_MODE = origMode;
  if (origThreshold === undefined) delete process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS;
  else process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS = origThreshold;
});

test("the route holds NO predicate of its own", () => {
  const src = readFileSync(
    join(process.cwd(), "app/api/cron/inventory-stale-sweep/route.ts"), "utf8")
    .split("\n").map((l) => l.split("//")[0]).join("\n");
  assert.ok(src.includes("staleSweepWhere"), "it composes the shared predicate");
  assert.ok(!/lane:\s*\{\s*not:/.test(src), "no inline lane guard may survive here");
  assert.ok(!/48\s*\*\s*3600000/.test(src), "no second freshness literal — freshnessCutoff owns it");
});

test("dry_run is the default: it counts candidates and deactivates NOTHING", async () => {
  delete process.env.INVENTORY_STALE_SWEEP_MODE;
  staleRows = rows(95);
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  const res = await GET(cronReq());
  const body = await res.json() as { data: Record<string, unknown> };

  assert.equal(body.data.mode, "dry_run");
  assert.equal(body.data.candidates, 95);
  assert.equal(body.data.deactivated, 0);
  assert.equal(itemCalls.updateMany.length, 0, "not one row may be flipped in dry_run");
  assert.equal(removalEmails.length, 0, "and no dealer may be told about a removal that did not happen");
});

test("enforce deactivates and records the ids for undo", async () => {
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  staleRows = rows(95);
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  const res = await GET(cronReq());
  const body = await res.json() as { data: Record<string, unknown> };

  assert.equal(body.data.mode, "enforce");
  assert.equal(body.data.deactivated, 95);
  assert.equal(itemCalls.updateMany.length, 1);
  assert.equal((body.data.deactivatedIds as string[]).length, 95,
    "rollback must be a literal UPDATE ... WHERE id IN (...), not a re-derived predicate");
});

test("the blast-radius breaker refuses, alerts once, and is NOT a failed cron", async () => {
  // A repeat of the 2026-08 HTTP 429 blackout would make every row stale. With a correct
  // predicate and no breaker that is a catalogue wipe.
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  process.env.INVENTORY_SWEEP_MAX_DEACTIVATIONS = "150";
  staleRows = rows(400);
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  const res = await GET(cronReq());
  const body = await res.json() as { data: Record<string, unknown> };

  assert.equal(body.data.aborted, true);
  assert.equal(body.data.deactivated, 0);
  assert.equal(itemCalls.updateMany.length, 0);
  assert.equal(notifications.length, 1, "exactly one alert");
  assert.equal(cronLog.update.at(-1)!.status, "COMPLETED",
    "an aborted sweep did what it was told — it is not a failed cron");
});

test("off writes a CronJobLog anyway — a disabled sweep must not read as a DEAD cron", async () => {
  process.env.INVENTORY_STALE_SWEEP_MODE = "off";
  staleRows = rows(95);
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  const res = await GET(cronReq());
  const body = await res.json() as { data: Record<string, unknown> };

  assert.equal(body.data.skipped, true);
  assert.equal(cronLog.create.length, 1, "the run is still recorded");
  assert.equal(cronLog.create[0]!.cronName, "inventory-stale-sweep");
  assert.equal(cronLog.update.at(-1)!.status, "COMPLETED");
  assert.equal(itemCalls.findMany.length, 0, "and it does no work");
});

test("dealer-owned removals are emailed, and only on a real deactivation", async () => {
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  staleRows = rows(3, true);
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  await GET(cronReq());

  assert.equal(removalEmails.length, 1, "one email per affected dealer");
  assert.equal((removalEmails[0]!.affectedVehicles as unknown[]).length, 3);
  // This is the regression the new predicate had to protect: pinning dealerId: null in the
  // sweep would have made this email structurally unreachable dead code.
});

test("the FS-G suppression survives: no feed-failure email when no sync was ever attempted", async () => {
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  staleRows = [];
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  await GET(cronReq());
  assert.equal(failureEmails.length, 0);
});
