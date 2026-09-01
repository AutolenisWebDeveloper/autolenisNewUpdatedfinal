// moveBuyerWorkflowStage AND cancelBuyerWorkflow must go through the guarded deal seam.
//
// The defect this pins: it wrote `prisma.deal.update({ data: { status } })`
// directly — a second, unguarded state machine sitting beside advanceDealStatus.
// Two live admin buttons (journey/complete and journey/complete-all) drive it all
// the way to COMPLETED, so for every admin-completed deal the system skipped:
//   • the compare-and-swap (a stale read could revert a COMPLETED deal),
//   • emitDealCompletionEvent — the canonical `purchase_completed` signal that
//     Program 5 (affiliate settlement) consumes, so admin completions never paid out,
//   • emitDealStatusComms and the BuyerActivityEvent,
//   • the insurance hard-gate.
// The PR's "exactly-once completion event" guarantee held only for deals that
// happened to complete through the seam.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "lib/services/admin/__tests__/workflow-stage-seam.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface DealRow { id: string; buyerId: string; status: string }

let dealRow: DealRow | null = null;
let advanceCalls: Array<{ dealId: string; to: string; opts: Record<string, unknown> }> = [];
let rawStatusWrites: Array<Record<string, unknown>> = [];
let historyCreates: Array<Record<string, unknown>> = [];
let auditCreates: Array<Record<string, unknown>> = [];
let cancelDealCalls: Array<{ dealId: string; reason: string; actor?: Record<string, unknown> }> = [];
// The seam declines when a concurrent writer moved the deal first.
let cancelSucceeds = true;

const TRANSITIONS: Record<string, string[]> = {
  SIGNED: ["PICKUP_SCHEDULED"],
  PICKUP_SCHEDULED: ["PICKUP_COMPLETE", "COMPLETED"],
  PICKUP_COMPLETE: ["COMPLETED"],
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: {
        findFirst: async () => (dealRow ? { ...dealRow } : null),
        update: async (a: { data: Record<string, unknown> }) => {
          // Any direct status write here is the defect.
          if ("status" in a.data) rawStatusWrites.push(a.data);
          return {};
        },
      },
      dealStatusHistory: { create: async (a: { data: Record<string, unknown> }) => { historyCreates.push(a.data); return {}; } },
      adminAuditLog: { create: async (a: { data: Record<string, unknown> }) => { auditCreates.push(a.data); return {}; } },
      buyerActivityEvent: { create: async () => ({}) },
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    canTransition: (from: string, to: string) => (TRANSITIONS[from] ?? []).includes(to),
    advanceDealStatus: async (dealId: string, to: string, opts: Record<string, unknown> = {}) => {
      advanceCalls.push({ dealId, to, opts });
      if (dealRow) dealRow.status = to;
      return true;
    },
    cancelDeal: async (dealId: string, reason: string, actor?: Record<string, unknown>) => {
      cancelDealCalls.push({ dealId, reason, actor });
      if (!cancelSucceeds) return false;
      if (dealRow) dealRow.status = "CANCELLED";
      return true;
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function load() {
  return import("@/lib/services/admin/admin-buyer-command-center.service");
}

beforeEach(() => {
  dealRow = { id: "deal_1", buyerId: "buyer_1", status: "PICKUP_SCHEDULED" };
  advanceCalls = [];
  rawStatusWrites = [];
  historyCreates = [];
  auditCreates = [];
  cancelDealCalls = [];
  cancelSucceeds = true;
});

test("completing a deal routes through advanceDealStatus, never a raw status write", async () => {
  const { moveBuyerWorkflowStage } = await load();
  await moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "admin completed");

  assert.equal(rawStatusWrites.length, 0, "must NOT write deal.status directly — that bypasses the completion event");
  assert.equal(advanceCalls.length, 1, "must go through the guarded seam exactly once");
  assert.equal(advanceCalls[0]!.dealId, "deal_1");
  assert.equal(advanceCalls[0]!.to, "COMPLETED");
  assert.equal(advanceCalls[0]!.opts.actorRole, "ADMIN");
  assert.equal(advanceCalls[0]!.opts.actorId, "admin_1");
  assert.equal(advanceCalls[0]!.opts.reason, "admin completed");
});

test("the seam owns the history row — no duplicate written here", async () => {
  const { moveBuyerWorkflowStage } = await load();
  await moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "admin completed");
  assert.equal(historyCreates.length, 0, "advanceDealStatus writes DealStatusHistory; writing it here too duplicates it");
});

test("the admin audit log is still written (admin accountability preserved)", async () => {
  const { moveBuyerWorkflowStage } = await load();
  await moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "admin completed");
  assert.equal(auditCreates.length, 1);
  assert.equal(auditCreates[0]!.action, "STAGE_ADVANCE");
  assert.equal(auditCreates[0]!.adminId, "admin_1");
});

test("an illegal stage jump without force is still rejected before any write", async () => {
  dealRow = { id: "deal_1", buyerId: "buyer_1", status: "SIGNED" };
  const { moveBuyerWorkflowStage } = await load();
  await assert.rejects(
    () => moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "bad jump"),
    /not a valid next stage/i,
  );
  assert.equal(advanceCalls.length, 0);
  assert.equal(rawStatusWrites.length, 0);
});

test("force=true is passed through to the seam (deliberate admin override preserved)", async () => {
  dealRow = { id: "deal_1", buyerId: "buyer_1", status: "SIGNED" };
  const { moveBuyerWorkflowStage } = await load();
  await moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "override", true);
  assert.equal(advanceCalls.length, 1);
  assert.equal(advanceCalls[0]!.opts.force, true, "the admin override must still bypass the transition guard");
});

test("a deal that is already CANCELLED/COMPLETED is not movable", async () => {
  dealRow = null; // findFirst excludes terminal states
  const { moveBuyerWorkflowStage } = await load();
  await assert.rejects(
    () => moveBuyerWorkflowStage("buyer_1", "admin_1", "a@x.com", "deal_1", "COMPLETED" as never, "x"),
    /no active deal/i,
  );
  assert.equal(advanceCalls.length, 0);
});

// ── cancelBuyerWorkflow: the last raw deal.status writer ────────────────────
// It wrote `prisma.deal.update({ data: { status: CANCELLED } })` directly. Unlike
// the move path it DID hand-write its DealStatusHistory row, so history was not the
// gap — the guard was. The raw write skipped:
//   • the compare-and-swap, so a cancel racing a concurrent advance overwrote the
//     winner unconditionally and recorded a fromStatus that was already stale,
//   • the BuyerActivityEvent (no buyer-visible record of the cancellation), and
//   • emitDealStatusComms, so the buyer was never told their deal was cancelled.
// The seam already exposed cancelDeal() — correctly routed, and with zero callers.

test("cancelling routes through the seam's cancelDeal, never a raw status write", async () => {
  const { cancelBuyerWorkflow } = await load();
  await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "buyer changed their mind");

  assert.equal(rawStatusWrites.length, 0, "a raw deal.status write bypasses the CAS and the cancellation comms");
  assert.equal(cancelDealCalls.length, 1, "cancellation must go through the seam's terminal path");
  assert.equal(cancelDealCalls[0]!.dealId, "deal_1");
  assert.equal(cancelDealCalls[0]!.reason, "buyer changed their mind");
});

test("ADMIN attribution survives the move to the seam", async () => {
  const { cancelBuyerWorkflow } = await load();
  await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "cancelled by ops");

  const actor = cancelDealCalls[0]!.actor ?? {};
  assert.equal(actor.actorRole, "ADMIN", "the hand-written history recorded ADMIN; the seam-written row must too");
  assert.equal(actor.actorId, "admin_1", "an admin cancellation must not be attributed to SYSTEM");
});

test("the seam owns the cancellation history row — none hand-written here", async () => {
  const { cancelBuyerWorkflow } = await load();
  await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "x");
  assert.equal(historyCreates.length, 0, "advanceDealStatus writes DealStatusHistory; a second row here duplicates it");
});

test("the admin audit log is still written for a cancellation", async () => {
  const { cancelBuyerWorkflow } = await load();
  await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "x");
  assert.equal(auditCreates.length, 1, "admin accountability is not the seam's job — it stays here");
  assert.equal(auditCreates[0]!.action, "CANCEL");
  assert.equal(auditCreates[0]!.adminId, "admin_1");
});

test("a deal already terminal is rejected before anything is cancelled", async () => {
  dealRow = null; // findFirst excludes CANCELLED / COMPLETED / REFUNDED
  const { cancelBuyerWorkflow } = await load();
  await assert.rejects(
    () => cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "x"),
    /no active deal/i,
  );
  assert.equal(cancelDealCalls.length, 0);
  assert.equal(rawStatusWrites.length, 0);
});

test("a cancel the seam DECLINED is reported as not cancelled, never as success", async () => {
  // Routing through the seam introduced an outcome the raw write never had: a
  // concurrent advance can win the race, leaving the deal uncancelled. Returning a
  // hardcoded { cancelled: true } would tell the admin the deal was cancelled when
  // it was not — the same class of untruth as a status message for a state the
  // system is not in.
  cancelSucceeds = false;
  const { cancelBuyerWorkflow } = await load();
  const result = await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "raced");

  assert.equal(result.cancelled, false, "the admin must be told the cancellation did not take effect");
  assert.equal(auditCreates.length, 1, "the attempt is still audited");
  assert.equal(
    (auditCreates[0]!.metadata as Record<string, unknown>).cancelled,
    false,
    "and the audit row records the real outcome, not just the intent",
  );
});

test("a successful cancel reports cancelled: true", async () => {
  const { cancelBuyerWorkflow } = await load();
  const result = await cancelBuyerWorkflow("buyer_1", "admin_1", "a@x.com", "deal_1", "ok");
  assert.equal(result.cancelled, true);
  assert.equal((auditCreates[0]!.metadata as Record<string, unknown>).cancelled, true);
});
