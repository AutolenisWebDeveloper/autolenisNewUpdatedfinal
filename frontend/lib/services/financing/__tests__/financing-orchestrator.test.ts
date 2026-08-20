// Phase 5 Block 3 — the decisioning orchestrator ties Blocks 1–3 together:
// SUBMITTED → PENDING_LENDER → call the (mock) lender → apply the outcome.
//   APPROVED   → record outcome, update the existing Financing outcome, advance the
//               Deal FINANCING_PENDING → FEE_PENDING (via the existing deal machine).
//   CONDITIONAL→ park for human stip review.
//   DECLINED   → adverse-action: since the ECOA notice rule is EMPTY BY DEFAULT the
//               engine FAILS CLOSED — it does NOT generate/send a notice, it routes
//               to human review. No invented notice is ever produced.
//   adapter fail-closed → route to human review, never a silent decision.
//
// Run: pnpm test:financing

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  app: { id: "app_1", dealId: "deal_1", buyerId: "b1", status: "SUBMITTED", amountRequestedCents: 2_500_000, termMonths: 60, ssnEncrypted: "ENC:x", annualIncomeEncrypted: "ENC:y", financingPath: "DEALER" } as Record<string, unknown>,
  advanceCalls: [] as Array<{ to: string }>,
  lenderResult: { ok: true, decision: { outcome: "APPROVED", lenderReferenceId: "L1", approvedAmountCents: 2_500_000, aprRate: 7.9, termMonths: 60, monthlyPaymentCents: 50_400 } } as Record<string, unknown>,
  ruleResolution: { ok: false, reason: "RULE_ABSENT", ruleType: "ADVERSE_ACTION_NOTICE" } as Record<string, unknown>,
  dealAdvances: [] as Array<{ dealId: string; to: string }>,
  financingUpserts: [] as Array<Record<string, unknown>>,
  audit: [] as Array<Record<string, unknown>>,
  reviews: [] as Array<Record<string, unknown>>,
  financingUpsertThrows: false,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      creditApplication: { findUnique: async () => state.app },
      financing: { upsert: async (args: Record<string, unknown>) => { if (state.financingUpsertThrows) throw new Error("financing write failed"); state.financingUpserts.push(args); return {}; } },
    },
  },
});
mock.module("@/lib/security/field-encryption", {
  namedExports: { decryptOptionalField: (v: string | null) => (v == null ? null : "decrypted"), decryptField: () => "decrypted" },
});
mock.module("@/lib/services/financing/credit-application.service", {
  namedExports: {
    advanceApplication: async (_id: string, to: string) => { state.advanceCalls.push({ to }); state.app.status = to; },
  },
});
mock.module("@/lib/services/financing/lender/lender-service", {
  namedExports: {
    getLenderAdapter: () => ({ name: "mock", isConfigured: () => true }),
    submitCreditApplication: async () => state.lenderResult,
  },
});
mock.module("@/lib/services/financing/compliance-rule.service", {
  namedExports: { requireRuleOrFailClosed: async () => state.ruleResolution },
});
const dealAdvance = { throw: false };
mock.module("@/lib/services/deal/deal.service", {
  namedExports: {
    advanceDealStatus: async (dealId: string, to: string) => {
      if (dealAdvance.throw) throw new Error("deal not in expected state");
      state.dealAdvances.push({ dealId, to });
    },
  },
});
mock.module("@/lib/services/financing/financing-audit.service", {
  namedExports: { appendFinancingAuditEvent: async (e: Record<string, unknown>) => { state.audit.push(e); return { id: "e" }; } },
});
mock.module("@/lib/services/financing/review-queue.service", {
  namedExports: { routeToReview: async (input: Record<string, unknown>) => { state.reviews.push(input); return { id: "task_1" }; } },
});

beforeEach(() => {
  dealAdvance.throw = false;
  state.app = { id: "app_1", dealId: "deal_1", buyerId: "b1", status: "SUBMITTED", amountRequestedCents: 2_500_000, termMonths: 60, ssnEncrypted: "ENC:x", annualIncomeEncrypted: "ENC:y", financingPath: "DEALER" };
  state.advanceCalls = [];
  state.lenderResult = { ok: true, decision: { outcome: "APPROVED", lenderReferenceId: "L1", approvedAmountCents: 2_500_000, aprRate: 7.9, termMonths: 60, monthlyPaymentCents: 50_400 } };
  state.ruleResolution = { ok: false, reason: "RULE_ABSENT", ruleType: "ADVERSE_ACTION_NOTICE" };
  state.dealAdvances = [];
  state.financingUpserts = [];
  state.audit = [];
  state.reviews = [];
  state.financingUpsertThrows = false;
});

test("APPROVED → outcome recorded, Financing upserted, Deal advanced to FEE_PENDING", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  const res = await requestLenderDecision("app_1");
  assert.deepEqual(state.advanceCalls.map((c) => c.to), ["PENDING_LENDER", "APPROVED"]);
  assert.equal(state.financingUpserts.length, 1, "existing Financing outcome is updated (not a parallel model)");
  assert.deepEqual(state.dealAdvances, [{ dealId: "deal_1", to: "FEE_PENDING" }]);
  assert.equal(res.finalStatus, "APPROVED");
  assert.equal(res.dealAdvanced, true);
  assert.ok(state.audit.some((e) => e.eventType === "DECISION_RENDERED"));
});

test("DECLINED + adverse-action rule EMPTY → FAILS CLOSED to human review, no notice, Deal not advanced", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  state.lenderResult = { ok: true, decision: { outcome: "DECLINED", declineReasonCodes: ["07"] } };
  const res = await requestLenderDecision("app_1");
  assert.deepEqual(state.advanceCalls.map((c) => c.to), ["PENDING_LENDER", "DECLINED", "ADVERSE_ACTION_PENDING", "HUMAN_REVIEW"]);
  assert.equal(state.dealAdvances.length, 0, "a decline never advances the deal");
  assert.equal(res.finalStatus, "HUMAN_REVIEW");
  assert.equal(res.adverseAction, "BLOCKED_RULE_ABSENT");
  // No NOTICE_GENERATED / NOTICE_SENT event — the engine must not invent a notice.
  assert.equal(state.audit.some((e) => e.eventType === "NOTICE_SENT" || e.eventType === "NOTICE_GENERATED"), false);
  assert.equal(state.reviews[0]!.taskType, "ADVERSE_ACTION_REVIEW", "routed to the adverse-action review queue");
});

test("adapter FAIL-CLOSED (missing creds/error) → human review, no decision, deal not advanced", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  state.lenderResult = { ok: false, error: { code: "MISSING_CREDENTIALS", message: "x" } };
  const res = await requestLenderDecision("app_1");
  assert.deepEqual(state.advanceCalls.map((c) => c.to), ["PENDING_LENDER", "HUMAN_REVIEW"]);
  assert.equal(state.dealAdvances.length, 0);
  assert.equal(res.finalStatus, "HUMAN_REVIEW");
  assert.equal(state.reviews[0]!.taskType, "LENDER_FAILURE_REVIEW");
});

test("CONDITIONAL → parked for human stip review; deal not advanced", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  state.lenderResult = { ok: true, decision: { outcome: "CONDITIONAL", stipulations: ["proof of income"] } };
  const res = await requestLenderDecision("app_1");
  assert.deepEqual(state.advanceCalls.map((c) => c.to), ["PENDING_LENDER", "CONDITIONAL"]);
  assert.equal(state.dealAdvances.length, 0);
  assert.equal(res.finalStatus, "CONDITIONAL");
  assert.equal(state.reviews[0]!.taskType, "STIP_REVIEW");
});

test("APPROVED but downstream deal-advance fails → financing stays APPROVED, gap audited, dealAdvanced:false", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  dealAdvance.throw = true;
  const res = await requestLenderDecision("app_1");
  assert.equal(res.finalStatus, "APPROVED", "the approval is durable — not rolled back");
  assert.equal(res.dealAdvanced, false);
  assert.equal(state.financingUpserts.length, 1);
  assert.ok(
    state.audit.some((e) => e.eventType === "STATE_TRANSITION" && (e.payload as Record<string, unknown>).dealAdvanceFailed === true),
    "the deal-advance failure is recorded for reconciliation",
  );
});

test("APPROVED but Financing upsert fails → still APPROVED, breadcrumb audited, no uncaught throw", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  state.financingUpsertThrows = true;
  const res = await requestLenderDecision("app_1");
  assert.equal(res.finalStatus, "APPROVED", "approval is durable even when the Financing write fails");
  assert.ok(
    state.audit.some((e) => e.eventType === "STATE_TRANSITION" && (e.payload as Record<string, unknown>).financingUpsertFailed === true),
    "the Financing-write failure is recorded for reconciliation",
  );
});

test("rejects when the application is not in SUBMITTED", async () => {
  const { requestLenderDecision } = await import("@/lib/services/financing/financing-orchestrator.service");
  state.app.status = "APPROVED";
  await assert.rejects(() => requestLenderDecision("app_1"), /SUBMITTED/);
  assert.equal(state.advanceCalls.length, 0);
});
