// cancelDeal — the single terminal cancellation path.
//
// Cancellation was the last raw deal.status writer in the codebase:
// admin-buyer-command-center.service wrote
// `prisma.deal.update({ data: { status: CANCELLED } })` directly while
// cancelDeal() sat in the seam, correctly routed, with ZERO callers.
//
// These tests pin what routing through the seam buys, against the REAL
// advanceDealStatus (only prisma and the comms/completion emitters are mocked):
//   • the compare-and-swap actually guards the write,
//   • a cancel that loses a race does NOT clobber the winner,
//   • the history row carries the real actor,
//   • the buyer gets a DEAL_CANCELLED activity event and cancellation comms, and
//   • no completion event is emitted — a cancellation is not a completion.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/deal/__tests__/cancel-deal-seam.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface DealRow { id: string; buyerId: string; status: string; insuranceStatus: string }

let deal: DealRow;
let swapWheres: Array<Record<string, unknown>> = [];
let history: Array<Record<string, unknown>> = [];
let activity: Array<Record<string, unknown>> = [];
let commsCalls: Array<{ dealId: string; status: string }> = [];
let completionCalls: string[] = [];
/** Fires once, between the seam's read and its compare-and-swap, to simulate a
 *  concurrent writer committing inside that window. */
let raceHook: (() => void) | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findUnique: async ({ select }: { select?: Record<string, unknown> }) => {
          // Snapshot FIRST, then let the concurrent writer land: the reader must
          // see the pre-race value, which is what makes the window real.
          const snapshot = select ? { status: deal.status } : { ...deal };
          const hook = raceHook;
          if (hook) { raceHook = null; hook(); }
          return snapshot;
        },
        update: async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(deal, data);
          return { ...deal };
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          swapWheres.push(where);
          // The CAS: only move while the row is still in the state that was read.
          if (where.status !== undefined && deal.status !== where.status) return { count: 0 };
          Object.assign(deal, data);
          return { count: 1 };
        },
      },
      dealStatusHistory: { create: async ({ data }: { data: Record<string, unknown> }) => { history.push(data); return data; } },
      buyerActivityEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { activity.push(data); return data; } },
    },
  },
});

mock.module("@/lib/services/notifications/acquisition-comms", {
  namedExports: {
    emitDealStatusComms: async (dealId: string, status: string) => { commsCalls.push({ dealId, status }); },
  },
});

mock.module("@/lib/services/deal/deal-completion-event.service", {
  namedExports: {
    emitDealCompletionEvent: async (dealId: string) => { completionCalls.push(dealId); },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() { return import("@/lib/services/deal/deal.service"); }

beforeEach(() => {
  deal = { id: "deal_1", buyerId: "buyer_1", status: "CONTRACT_PENDING", insuranceStatus: "VERIFIED" };
  swapWheres = [];
  history = [];
  activity = [];
  commsCalls = [];
  completionCalls = [];
  raceHook = null;
});

test("cancelling goes through the compare-and-swap, not an unconditional write", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "buyer changed their mind");

  assert.equal(deal.status, "CANCELLED");
  assert.ok(swapWheres.length >= 1, "the status change must run through updateMany, not update");
  assert.equal(
    swapWheres[0]!.status,
    "CONTRACT_PENDING",
    "the CAS must be predicated on the status that was READ — that predicate is the whole guard",
  );
  assert.equal(swapWheres[0]!.id, "deal_1");
});

test("a cancel that LOSES a race does not clobber the winner", async () => {
  // The deal completes between the seam's read and its write. Cancelling a deal
  // that just completed would silently undo a finished purchase — precisely the
  // clobber the raw write allowed.
  const { cancelDeal } = await load();
  raceHook = () => { deal.status = "COMPLETED"; };

  await cancelDeal("deal_1", "cancel racing a completion");

  assert.equal(deal.status, "COMPLETED", "the concurrent winner must stand");
  assert.deepEqual(history, [], "a cancellation that never happened must not be recorded");
  assert.deepEqual(commsCalls, [], "and the buyer must not be told it was cancelled");
});

test("the history row records the real actor, not SYSTEM, when an admin cancels", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "cancelled by ops", { actorId: "admin_1", actorRole: "ADMIN" });

  assert.equal(history.length, 1, "the seam writes exactly one history row");
  assert.equal(history[0]!.fromStatus, "CONTRACT_PENDING");
  assert.equal(history[0]!.toStatus, "CANCELLED");
  assert.equal(history[0]!.actorRole, "ADMIN", "an admin cancellation attributed to SYSTEM loses accountability");
  assert.equal(history[0]!.actorId, "admin_1");
  assert.equal(history[0]!.reason, "cancelled by ops");
});

test("an unattributed cancel still defaults to SYSTEM (existing callers unchanged)", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "automated cancel");
  assert.equal(history[0]!.actorRole, "SYSTEM");
  assert.equal(history[0]!.actorId, null);
});

test("the buyer gets a DEAL_CANCELLED activity event", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "buyer changed their mind");

  const kinds = activity.map((a) => a.eventType);
  assert.ok(kinds.includes("DEAL_CANCELLED"), `expected a DEAL_CANCELLED event, got ${JSON.stringify(kinds)}`);
});

test("cancellation comms are emitted through the seam", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "buyer changed their mind");

  assert.deepEqual(
    commsCalls,
    [{ dealId: "deal_1", status: "CANCELLED" }],
    "the raw write told the buyer nothing; the seam is the one place cancellation comms are emitted",
  );
});

test("cancelling NEVER emits the completion event", async () => {
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "buyer changed their mind");
  assert.deepEqual(
    completionCalls,
    [],
    "purchase_completed drives affiliate settlement — a cancelled deal must never emit it",
  );
});

test("cancelling an already-cancelled deal is a safe no-op", async () => {
  deal.status = "CANCELLED";
  const { cancelDeal } = await load();
  await cancelDeal("deal_1", "double cancel");

  assert.equal(deal.status, "CANCELLED");
  assert.deepEqual(history, [], "no second history row for a deal already in the target state");
  assert.deepEqual(completionCalls, []);
});

// ── The single-writer invariant, as an executable guard ─────────────────────
// Findings 1 and 4 both traced back to a second component writing deal.status
// beside advanceDealStatus. Prose cannot stop the third one; this can. It parses
// every prisma.deal.update / updateMany in non-test source and fails if any sets
// `status` outside deal.service.ts, which owns the state machine.

test("deal.status has exactly ONE writer — advanceDealStatus's compare-and-swap", async () => {
  const { readFileSync, readdirSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");

  const ROOT = process.cwd();
  const SEAM = "lib/services/deal/deal.service.ts";
  const SKIP = new Set(["node_modules", ".next", "__tests__", "e2e", "scripts", ".git"]);

  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) files.push(full);
    }
  })(join(ROOT, "lib"));
  (function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".ts")) files.push(full);
    }
  })(join(ROOT, "app"));

  // [\s\S] rather than the `s` (dotAll) flag: the repo's tsconfig target predates es2018.
  const CALL = /prisma\.deal\.(?:update|updateMany)\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  const offenders: string[] = [];

  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === SEAM) continue; // the seam IS the writer
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(CALL)) {
      const blob = m[1]!;
      // `data: { ... status: ... }` — a literal status write.
      if (/\bdata\s*:\s*\{[^}]*\bstatus\s*:/.test(blob)) {
        offenders.push(`${rel}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `deal.status must only be written by advanceDealStatus (${SEAM}). ` +
      `A writer outside it skips the CAS, the history row, the buyer comms and the ` +
      `exactly-once completion event. Offenders: ${offenders.join(", ")}`,
  );
});
