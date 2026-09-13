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
/** Active dealers with a feed config, for the feed-failure branch. */
let dealersWithFeeds: Array<Record<string, unknown>> = [];
/** How many fresh inventory items a dealer has — 0 is what makes a feed look dead. */
let freshItemCount = 1;

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
        count: async () => freshItemCount,
      },
      dealer: {
        // Drivable, so the feed-failure branch can be exercised. It used to return [] always,
        // which made that whole branch — and both of its defects — unreachable from any test.
        findMany: async () => dealersWithFeeds,
        findUnique: async () => ({ id: "d1", dealershipName: "Metroplex Ford", user: { email: "ops@metroplex.test" } }),
      },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => { notifications.push(data); return { id: "n1" }; },
      },
    },
  },
});

// PHASE 4: both dealer emails moved onto the §27 outbox dispatcher. The resend mock stays so a
// regression BACK to a direct send is visible as a non-empty array rather than as a silence.
const enqueued: Array<Record<string, unknown>> = [];
mock.module("@/lib/services/comms/transactional-dispatcher.service", {
  namedExports: {
    enqueueTransactional: async (a: Record<string, unknown>) => { enqueued.push(a); return { enqueued: true }; },
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
  cronLog.create = []; cronLog.update = []; enqueued.length = 0;
  itemCalls.findMany = []; itemCalls.updateMany = [];
  removalEmails.length = 0; failureEmails.length = 0; notifications.length = 0;
  staleRows = [];
  dealersWithFeeds = [];
  freshItemCount = 1;
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

  // The CAPABILITY is unchanged; the PATH is the outbox. §27 requires every communication to
  // go through the dispatcher so it is deduped, state-rechecked and retried — a cron that
  // called Resend directly had none of that.
  assert.equal(enqueued.length, 1, "one enqueue per affected dealer");
  assert.equal(enqueued[0]!.templateKey, "dealer_stale_listing_removal");
  assert.equal(enqueued[0]!.recipientKind, "dealer");
  assert.equal(enqueued[0]!.recipientId, "d1");
  assert.match(String(enqueued[0]!.idempotencyKey), /^dealer_stale_listing_removal:d1:\d{4}-\d{2}-\d{2}$/,
    "keyed on the DAY: the retired direct call keyed on Date.now(), which is no idempotency at all");
  assert.equal(removalEmails.length, 0, "and it must not ALSO send directly");
  // THE ADDRESS IS IN THE PAYLOAD, which is the only place the drain can read it.
  // `comms_outbox` has no recipient-address column, so `to` is validated at enqueue and then
  // discarded; `deliverEmail` reads `payload.email` for both the suppression lookup and the
  // send. This row carried `to` and no `payload.email`, so every nightly sweep queued a
  // notification that checked suppression for `undefined` and asked the provider to mail
  // `undefined` — and the call site looked right, because `to` was there.
  const removalPayload = enqueued[0]!.payload as Record<string, unknown>;
  assert.equal(removalPayload.email, "ops@metroplex.test");
  assert.equal(enqueued[0]!.to, removalPayload.email, "the validated address and the sent address must be one address");
  // This is the regression the new predicate had to protect: pinning dealerId: null in the
  // sweep would have made this notification structurally unreachable dead code.
});

test("the feed-failure notice carries its address and links to a page that exists", async () => {
  // Two defects in one email, both of which made it useless rather than merely imperfect:
  // no `payload.email`, so it was delivered to `undefined`; and a call to action pointing at
  // `/dealer/inventory/feed`, which has never existed — the page is
  // `app/dealer/inventory/feed-setup/page.tsx`. A dealer whose feed has stopped sending data
  // needs exactly one working link, and that was the one.
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  staleRows = [];
  dealersWithFeeds = [
    {
      id: "d2",
      dealershipName: "Lakeside Toyota",
      user: { email: "feeds@lakeside.test" },
      feedConfig: { lastSyncAt: new Date("2026-09-01T00:00:00Z") },
    },
  ];
  freshItemCount = 0;

  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  await GET(cronReq());

  const feedRow = enqueued.find((e) => e.templateKey === "dealer_inventory_sync_failure");
  assert.ok(feedRow, "no feed-failure notice was enqueued");
  const payload = feedRow.payload as Record<string, unknown>;
  assert.equal(payload.email, "feeds@lakeside.test");
  assert.equal(feedRow.to, payload.email);
  assert.match(String(payload.html), /\/dealer\/inventory\/feed-setup/);
  assert.ok(
    !/\/dealer\/inventory\/feed["'\s]/.test(String(payload.html)),
    "the 404 target is still in the rendered email",
  );
});

test("the FS-G suppression survives: no feed-failure email when no sync was ever attempted", async () => {
  process.env.INVENTORY_STALE_SWEEP_MODE = "enforce";
  staleRows = [];
  const { GET } = await import("@/app/api/cron/inventory-stale-sweep/route");
  await GET(cronReq());
  assert.equal(failureEmails.length, 0);
});
