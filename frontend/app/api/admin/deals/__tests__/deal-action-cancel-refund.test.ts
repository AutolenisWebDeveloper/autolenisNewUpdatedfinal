// MONEY-PATH DEFECT 3 — regression tests for POST /api/admin/deals/[dealId]/action.
//
// TWO DEFECTS, ONE ROUTE, and §22.1 rules on both in one sentence each:
//
//   "Cancellation and refund are separate decisions. Cancelling a transaction does
//    not entitle a refund, and issuing a refund does not erase the transaction
//    record."
//   "Refunds are reviewed manually. There is no automatic refund."
//
// (1) DEAL_CANCELLED refunded the buyer's deposit as a SIDE EFFECT of cancelling.
//     That is both rules broken at once, and it moved real money on an action an
//     administrator took for a different purpose. It also wrote the deal status by
//     calling `advanceDealStatus` directly rather than through `cancelDeal`, which is
//     the one terminal cancellation path — bypassing the `expectedFrom` pin that stops
//     a cancel racing a concurrent completion and silently undoing a finished purchase.
//
// (2) REFUND_TRIGGERED advanced the deal to REFUNDED even when the refund primitive
//     returned NO_CHARGE, under a comment calling it "an admin bookkeeping transition".
//     The buyer NOTIFICATION was already gated on the real outcome, so the deal record
//     and the message the buyer received disagreed with each other: the deal said
//     refunded, the buyer was told "if a refund is due, our team will follow up".
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/deal-action-cancel-refund.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Ctrl {
  deal: Record<string, unknown> | null;
  deposit: Record<string, unknown> | null;
  refundOutcome: "REFUNDED" | "ALREADY_REFUNDED" | "NO_CHARGE" | "NOT_SUCCEEDED";
  refundCalls: number;
  cancelDealCalls: Array<{ dealId: string; reason: string }>;
  cancelDealResult: boolean;
  advances: Array<{ dealId: string; status: string }>;
  notifications: Array<Record<string, unknown>>;
  audits: Array<Record<string, unknown>>;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ adminId: "adm_1", email: "ops@autolenis.com", role: "SUPER_ADMIN" }),
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      deal: { findUnique: async () => ctrl.deal },
      deposit: { findFirst: async () => ctrl.deposit },
      notification: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.notifications.push(data); return {}; },
      },
      adminAuditLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => { ctrl.audits.push(data); return {}; },
      },
    },
  },
});

mock.module("@/lib/services/payment/refund.service", {
  namedExports: {
    refundDepositCharge: async () => {
      ctrl.refundCalls += 1;
      return { outcome: ctrl.refundOutcome, stripeRefundId: ctrl.refundOutcome === "REFUNDED" ? "re_1" : null };
    },
  },
});

mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, status: string) => {
      ctrl.advances.push({ dealId, status });
      return true;
    },
    cancelDeal: async (dealId: string, reason: string) => {
      ctrl.cancelDealCalls.push({ dealId, reason });
      return ctrl.cancelDealResult;
    },
    DealTransitionError: class extends Error {},
    InsuranceRequiredError: class extends Error {},
  },
});

mock.module("@/lib/services/email/resend.service", {
  namedExports: {
    sendDealerContractPendingEmail: async () => {},
    sendDealerContractIssuesEmail: async () => {},
    sendDealCompleteEmail: async () => {},
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

async function loadPOST() {
  return (await import("@/app/api/admin/deals/[dealId]/action/route")).POST;
}

function req(action: string) {
  return {
    json: async () => ({ action, reason: "buyer asked to stop" }),
  } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ dealId: "deal_1" });

beforeEach(() => {
  ctrl = {
    deal: { id: "deal_1", buyerId: "buyer_1", status: "FEE_PENDING", buyer: { id: "buyer_1" } },
    deposit: { id: "dep_1", buyerId: "buyer_1", status: "PAID", stripePaymentIntentId: "pi_real_1" },
    refundOutcome: "REFUNDED",
    refundCalls: 0,
    cancelDealCalls: [],
    cancelDealResult: true,
    advances: [],
    notifications: [],
    audits: [],
  };
});

// ── (1) Cancellation is not a refund ─────────────────────────────────────────

test("DEFECT 3: DEAL_CANCELLED does NOT refund the deposit", async () => {
  const POST = await loadPOST();
  const res = (await POST(req("DEAL_CANCELLED"), { params })) as unknown as { __kind: string };

  assert.equal(res.__kind, "success");
  assert.equal(
    ctrl.refundCalls,
    0,
    "§22.1: cancelling does not entitle a refund, and there is no automatic refund. " +
      "Real money must not move because an administrator cancelled a deal.",
  );
});

test("DEAL_CANCELLED routes through the cancelDeal seam, not a direct status advance", async () => {
  const POST = await loadPOST();
  await POST(req("DEAL_CANCELLED"), { params });

  assert.deepEqual(ctrl.cancelDealCalls, [{ dealId: "deal_1", reason: "buyer asked to stop" }]);
  assert.equal(
    ctrl.advances.filter((a) => a.status === "CANCELLED").length,
    0,
    "cancelDeal is the ONE terminal cancellation path; calling advanceDealStatus directly " +
      "skips its expectedFrom pin, which is what stops a cancel clobbering a concurrent completion",
  );
});

test("a cancellation that lost the race is reported, not reported as success", async () => {
  ctrl.cancelDealResult = false;
  const POST = await loadPOST();
  const res = (await POST(req("DEAL_CANCELLED"), { params })) as unknown as { __kind: string; code: string };

  assert.equal(res.__kind, "error");
  assert.equal(res.code, "INVALID_STATE");
});

test("the buyer is never told a refund is coming on a cancellation", async () => {
  const POST = await loadPOST();
  await POST(req("DEAL_CANCELLED"), { params });

  const buyerNote = ctrl.notifications.find((n) => n.buyerId === "buyer_1");
  assert.ok(buyerNote, "the buyer is still told their deal was cancelled");
  assert.ok(
    !String(buyerNote!.body).includes("refunded"),
    "and not told their deposit was refunded, because it was not",
  );
});

// ── (2) REFUNDED is a claim about money ──────────────────────────────────────

test("DEFECT 3: REFUND_TRIGGERED does NOT advance the deal to REFUNDED when no money moved", async () => {
  ctrl.refundOutcome = "NO_CHARGE";
  const POST = await loadPOST();
  const res = (await POST(req("REFUND_TRIGGERED"), { params })) as unknown as { __kind: string; code: string };

  assert.equal(res.__kind, "error");
  assert.equal(res.code, "NO_REFUND_PERFORMED");
  assert.equal(
    ctrl.advances.filter((a) => a.status === "REFUNDED").length,
    0,
    "§22.1: a no-charge record is never labelled as money refunded. REFUNDED is a claim " +
      "about money and is written only when money actually went back.",
  );
});

test("NOT_SUCCEEDED is refused too, and says which of the reasons applies", async () => {
  ctrl.refundOutcome = "NOT_SUCCEEDED";
  const POST = await loadPOST();
  const res = (await POST(req("REFUND_TRIGGERED"), { params })) as unknown as { code: string; message: string };

  assert.equal(res.code, "NO_REFUND_PERFORMED");
  assert.match(res.message, /never succeeded/);
  assert.equal(ctrl.advances.filter((a) => a.status === "REFUNDED").length, 0);
});

test("a buyer with no settled deposit is refused rather than silently marked refunded", async () => {
  ctrl.deposit = null;
  const POST = await loadPOST();
  const res = (await POST(req("REFUND_TRIGGERED"), { params })) as unknown as { code: string; message: string };

  assert.equal(res.code, "NO_REFUND_PERFORMED");
  assert.match(res.message, /no settled deposit/);
  assert.equal(ctrl.refundCalls, 0);
  assert.equal(ctrl.advances.length, 0);
});

test("a REAL refund still advances the deal and still tells the buyer", async () => {
  const POST = await loadPOST();
  const res = (await POST(req("REFUND_TRIGGERED"), { params })) as unknown as { __kind: string };

  assert.equal(res.__kind, "success");
  assert.equal(ctrl.refundCalls, 1);
  assert.deepEqual(
    ctrl.advances.filter((a) => a.status === "REFUNDED"),
    [{ dealId: "deal_1", status: "REFUNDED" }],
    "the fix must not break the case that was always correct",
  );
  const note = ctrl.notifications.find((n) => n.buyerId === "buyer_1");
  assert.match(String(note!.body), /refund has been processed/);
});
