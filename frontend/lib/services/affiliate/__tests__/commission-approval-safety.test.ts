// M2/M16 — commissions must follow the money, not the calendar.
//
//   • reverseCommissionsForPaymentIntent: when a fee PI is refunded, its
//     PENDING/APPROVED commissions flip to REVERSED via a status-guarded
//     compare-and-set; PAID ones are NEVER auto-touched — they are returned so
//     the caller can raise a manual-clawback ops alert.
//   • approveMaturePendingCommissions: the hourly cron may only approve a
//     PENDING commission that is ≥7 days old AND whose underlying payment is
//     verifiably clean — the fee PaymentIntent's charge is not refunded,
//     partially refunded, or disputed (read from Stripe directly, because the
//     webhook ledger has never recorded a production event — M16) AND whose
//     linked deal is not CANCELLED/REFUNDED. Unverifiable payment state fails
//     CLOSED: the commission stays PENDING for a later run.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/affiliate/__tests__/commission-approval-safety.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/logger", {
  namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } },
});
mock.module("@/lib/events/emit", { namedExports: { emitDomainEvent: async () => {} } });

type Commission = {
  id: string;
  status: string;
  dealId: string;
  qualifyingEventId: string;
  createdAt: Date;
};

interface Ctrl {
  commissions: Commission[];
  deals: Array<{ id: string; status: string }>;
  // per-PI Stripe behavior: "clean" | "refunded" | "partial" | "disputed" | "error" | "no_charge"
  stripe: Record<string, string>;
  updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  retrieveCalls: string[];
}
let ctrl: Ctrl;

function matchesStatus(row: Commission, where: Record<string, unknown>): boolean {
  const st = where.status as { in?: string[] } | string | undefined;
  if (typeof st === "string") return row.status === st;
  if (st && Array.isArray(st.in)) return st.in.includes(row.status);
  return true;
}

const prismaMock = {
  commission: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      ctrl.updateManyCalls.push({ where, data });
      let hit = 0;
      const prefix = (where.qualifyingEventId as { startsWith?: string } | undefined)?.startsWith;
      const idIn = (where.id as { in?: string[] } | undefined)?.in;
      for (const c of ctrl.commissions) {
        if (prefix && !c.qualifyingEventId.startsWith(prefix)) continue;
        if (idIn && !idIn.includes(c.id)) continue;
        if (!matchesStatus(c, where)) continue;
        c.status = data.status as string;
        hit += 1;
      }
      return { count: hit };
    },
    findMany: async ({ where, take, orderBy }: { where: Record<string, unknown>; take?: number; orderBy?: unknown }) => {
      const prefix = (where.qualifyingEventId as { startsWith?: string } | undefined)?.startsWith;
      const createdLte = (where.createdAt as { lte?: Date } | undefined)?.lte;
      const idGt = (where.id as { gt?: string } | undefined)?.gt;
      let rows = ctrl.commissions.filter((c) => {
        if (prefix && !c.qualifyingEventId.startsWith(prefix)) return false;
        if (createdLte && !(c.createdAt <= createdLte)) return false;
        // P2-4/P2-2 — keyset pagination the starvation fix depends on: the
        // filter applies REGARDLESS of the row's current status, exactly like
        // a real `id > cursor` predicate (no cursor-row-left-the-set hazard).
        if (idGt !== undefined && !(c.id > idGt)) return false;
        return matchesStatus(c, where);
      });
      if (orderBy && !Array.isArray(orderBy) && (orderBy as { id?: string }).id === "asc") {
        rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      }
      if (take !== undefined) rows = rows.slice(0, take);
      return rows;
    },
  },
  deal: {
    findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
      ctrl.deals.filter((d) => where.id.in.includes(d.id)),
  },
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/services/payment/stripe.service", {
  namedExports: {
    retrievePaymentIntent: async (piId: string) => {
      ctrl.retrieveCalls.push(piId);
      const mode = ctrl.stripe[piId] ?? "clean";
      if (mode === "error") throw new Error("stripe unreachable");
      if (mode === "no_charge") return { id: piId, latest_charge: null };
      return {
        id: piId,
        latest_charge: {
          id: `ch_${piId}`,
          refunded: mode === "refunded",
          amount_refunded: mode === "refunded" ? 40000 : mode === "partial" ? 5000 : 0,
          disputed: mode === "disputed",
        },
      };
    },
  },
});

beforeEach(() => {
  ctrl = { commissions: [], deals: [], stripe: {}, updateManyCalls: [], retrieveCalls: [] };
});

const NOW = new Date("2026-08-29T00:00:00Z");
const OLD = new Date("2026-08-10T00:00:00Z"); // > 7 days before NOW

async function svc() {
  return import("@/lib/services/affiliate/commission.service");
}

test("reverse: PENDING and APPROVED flip to REVERSED; PAID is untouched and reported for review", async () => {
  const { reverseCommissionsForPaymentIntent } = await svc();
  ctrl.commissions = [
    { id: "c1", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_A-L1", createdAt: OLD },
    { id: "c2", status: "APPROVED", dealId: "d1", qualifyingEventId: "pi_A-L2", createdAt: OLD },
    { id: "c3", status: "PAID", dealId: "d1", qualifyingEventId: "pi_A-L3", createdAt: OLD },
    { id: "c4", status: "PENDING", dealId: "d2", qualifyingEventId: "pi_B-L1", createdAt: OLD },
  ];
  const result = await reverseCommissionsForPaymentIntent("pi_A");
  assert.equal(result.reversed, 2);
  assert.deepEqual(result.paidNeedingReview, ["c3"]);
  assert.equal(ctrl.commissions.find((c) => c.id === "c1")!.status, "REVERSED");
  assert.equal(ctrl.commissions.find((c) => c.id === "c2")!.status, "REVERSED");
  assert.equal(ctrl.commissions.find((c) => c.id === "c3")!.status, "PAID", "PAID must never auto-reverse");
  assert.equal(ctrl.commissions.find((c) => c.id === "c4")!.status, "PENDING", "other PIs untouched");
  // the flip must be a status-guarded CAS scoped by key prefix, not a blind update
  const flip = ctrl.updateManyCalls[0];
  assert.equal((flip.where.qualifyingEventId as { startsWith: string }).startsWith, "pi_A-L");
  assert.deepEqual((flip.where.status as { in: string[] }).in.sort(), ["APPROVED", "PENDING"]);
});

test("cron approve: clean payment + live deal approves; refunded/partial/disputed payment does not", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = [
    { id: "ok", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_clean-L1", createdAt: OLD },
    { id: "ref", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_ref-L1", createdAt: OLD },
    { id: "part", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_part-L1", createdAt: OLD },
    { id: "disp", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_disp-L1", createdAt: OLD },
  ];
  ctrl.stripe = { pi_clean: "clean", pi_ref: "refunded", pi_part: "partial", pi_disp: "disputed" };
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 1);
  assert.equal(ctrl.commissions.find((c) => c.id === "ok")!.status, "APPROVED");
  for (const id of ["ref", "part", "disp"]) {
    assert.equal(ctrl.commissions.find((c) => c.id === id)!.status, "PENDING", `${id} must stay PENDING`);
  }
});

test("cron approve: CANCELLED/REFUNDED deal blocks approval even with clean payment", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [
    { id: "d_ok", status: "COMPLETED" },
    { id: "d_can", status: "CANCELLED" },
    { id: "d_ref", status: "REFUNDED" },
  ];
  ctrl.commissions = [
    { id: "a", status: "PENDING", dealId: "d_ok", qualifyingEventId: "pi_1-L1", createdAt: OLD },
    { id: "b", status: "PENDING", dealId: "d_can", qualifyingEventId: "pi_2-L1", createdAt: OLD },
    { id: "c", status: "PENDING", dealId: "d_ref", qualifyingEventId: "pi_3-L1", createdAt: OLD },
  ];
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 1);
  assert.equal(ctrl.commissions.find((c) => c.id === "a")!.status, "APPROVED");
  assert.equal(ctrl.commissions.find((c) => c.id === "b")!.status, "PENDING");
  assert.equal(ctrl.commissions.find((c) => c.id === "c")!.status, "PENDING");
});

test("cron approve: unverifiable payment state fails CLOSED (stripe error or missing charge)", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = [
    { id: "err", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_err-L1", createdAt: OLD },
    { id: "noch", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_noch-L1", createdAt: OLD },
  ];
  ctrl.stripe = { pi_err: "error", pi_noch: "no_charge" };
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 0);
  assert.equal(ctrl.commissions.find((c) => c.id === "err")!.status, "PENDING");
  assert.equal(ctrl.commissions.find((c) => c.id === "noch")!.status, "PENDING");
});

test("cron approve: age gate still holds — young commissions are not candidates", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = [
    { id: "young", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_y-L1", createdAt: new Date("2026-08-27T00:00:00Z") },
  ];
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 0);
  assert.equal(ctrl.commissions[0].status, "PENDING");
  assert.equal(ctrl.retrieveCalls.length, 0, "no Stripe call for non-candidates");
});

test("cron approve: one Stripe read per unique PI (levels share the check)", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = [
    { id: "l1", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_X-L1", createdAt: OLD },
    { id: "l2", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_X-L2", createdAt: OLD },
    { id: "l3", status: "PENDING", dealId: "d1", qualifyingEventId: "pi_X-L3", createdAt: OLD },
  ];
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 3);
  assert.deepEqual(ctrl.retrieveCalls, ["pi_X"]);
});

// P2-4 (review) — a head-of-queue backlog of permanently-skipped rows
// (missing deal) must not starve approvable rows behind it: the cron pages
// past the first take(500) with an id cursor.
test("cron approve: 500+ unverifiable head rows do not starve an approvable row behind them", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = Array.from({ length: 501 }, (_, i) => ({
    id: `dead${String(i).padStart(4, "0")}`,
    status: "PENDING",
    dealId: "d_missing", // no deal row → skippedUnverifiable, forever
    qualifyingEventId: `pi_dead${i}-L1`,
    createdAt: OLD,
  }));
  ctrl.commissions.push({
    id: "zz-approvable",
    status: "PENDING",
    dealId: "d1",
    qualifyingEventId: "pi_ok-L1",
    createdAt: OLD,
  });
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 1, "the row behind the dead backlog must be reached and approved");
  assert.equal(result.skippedUnverifiable, 501);
  assert.equal(ctrl.commissions.find((c) => c.id === "zz-approvable")!.status, "APPROVED");
});

// P2-2 (second review) — batch-boundary hazard: when the last row of a batch
// is APPROVED by that batch (leaving the PENDING filter), the first row of
// the next batch must not be silently skipped. Keyset `id > cursor` makes the
// boundary independent of the boundary row's new status.
test("cron approve: a row right after an approved batch boundary is not skipped", async () => {
  const { approveMaturePendingCommissions } = await svc();
  ctrl.deals = [{ id: "d1", status: "SIGNED" }];
  ctrl.commissions = Array.from({ length: 501 }, (_, i) => ({
    id: `ok${String(i).padStart(4, "0")}`,
    status: "PENDING",
    dealId: "d1",
    qualifyingEventId: `pi_ok${i}-L1`,
    createdAt: OLD,
  }));
  const result = await approveMaturePendingCommissions(NOW);
  assert.equal(result.approved, 501, "all 501 must approve — the boundary row's status change must not skip its successor");
  assert.equal(ctrl.commissions.filter((c) => c.status === "APPROVED").length, 501);
});
