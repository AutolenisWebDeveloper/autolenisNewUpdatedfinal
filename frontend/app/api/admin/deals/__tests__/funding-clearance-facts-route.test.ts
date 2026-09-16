// P9-00 — POST /api/admin/deals/[dealId]/funding-clearance, action RECORD_CLEARANCE_FACTS.
//
// WHAT THIS ROUTE ACTION CLOSES. Phase 8 shipped the Stage 14 gate — `evaluateFundingClearance`
// and a `clearFunding` that refuses unless all six items pass — with no way to satisfy three of
// them. Every reference to `financing.lenderConditionsClearedAt`, `financing.downPaymentMethod`
// and `financing.dealerFundingConfirmedAt` was a READ. So `deals.funding_cleared_at` could never
// be stamped, and every non-forced advance to COMPLETED hit the release gate (which until #437
// surfaced as an unhandled 500 to a dealer standing at the vehicle).
//
// THE PERMISSION IS NOT WIDENED. §13-D32 ruled `finance.funding.clear` on the MONEY tier —
// SUPER_ADMIN and FINANCE_ADMIN. Stage 14's "an authorized Finance or Operations administrator"
// describes who does the work rather than granting a permission, and admitting OPERATIONS_ADMIN
// to a MONEY-tier permission is a widening that is hard to reverse. Recording the facts a
// release is granted on is the same authority as granting it, so it sits behind the same gate.
// A test pins the exact permission string, because "same gate" is a claim about a constant.
//
// THE BACKDATING OMISSION IS PINNED. The caller states WHETHER a fact holds; the service stamps
// WHEN. `facts` is `.strict()`, so a caller-supplied timestamp is refused rather than ignored.
// That omission is load-bearing — an administrator who could backdate a clearance fact could
// make the evidence of a release predate the release — and an omission that matters needs a
// test, or the next reader "fixes the inconsistency" and reintroduces the defect.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/admin/deals/__tests__/funding-clearance-facts-route.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

class FundingClearanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "FundingClearanceError";
  }
}

interface Ctrl {
  permissionsAsked: string[];
  gateOk: boolean;
  recordCalls: Array<Record<string, unknown>>;
  recordThrows: Error | null;
}
let ctrl: Ctrl;

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    adminError: (code: string, message: string, status: number) => ({ __kind: "error", code, message, status }),
    adminSuccess: (data: unknown) => ({ __kind: "success", data }),
  },
});

mock.module("@/lib/auth/permissions", {
  namedExports: {
    requirePermissionStrict: async (_req: unknown, permission: string) => {
      ctrl.permissionsAsked.push(permission);
      return ctrl.gateOk
        ? { ok: true, admin: { adminId: "adm_fin_1", email: "finance@autolenis.com", role: "FINANCE_ADMIN" } }
        : { ok: false, code: "FORBIDDEN", message: "Not permitted", status: 403 };
    },
  },
});

mock.module("@/lib/services/deal/funding-clearance.service", {
  namedExports: {
    evaluateFundingClearance: async () => ({ clear: false, items: [], outstanding: [] }),
    recordClearanceFacts: async (p: Record<string, unknown>) => {
      ctrl.recordCalls.push(p);
      if (ctrl.recordThrows) throw ctrl.recordThrows;
      return { recorded: ["lender_conditions"] };
    },
    clearFunding: async () => ({ cleared: true, outstanding: [] }),
    recordFinancingCompletion: async () => {},
    sendBackForFinancingChange: async () => ({}),
    FundingClearanceError,
  },
});

mock.module("@/lib/services/financing/financing-checkpoint.service", {
  namedExports: { FinancingCheckpointError: class extends Error {} },
});

async function loadPOST() {
  return (await import("@/app/api/admin/deals/[dealId]/funding-clearance/route")).POST;
}

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<Awaited<ReturnType<typeof loadPOST>>>[0];
}
const params = Promise.resolve({ dealId: "deal_1" });

beforeEach(() => {
  ctrl = { permissionsAsked: [], gateOk: true, recordCalls: [], recordThrows: null };
});

test("the action is gated on finance.funding.clear — the MONEY-tier permission, not a wider one", async () => {
  const POST = await loadPOST();
  await POST(
    req({ action: "RECORD_CLEARANCE_FACTS", reason: "Lender stipulations cleared", facts: { lenderConditionsCleared: true } }),
    { params },
  );
  assert.deepEqual(
    ctrl.permissionsAsked,
    ["finance.funding.clear"],
    "§13-D32 ruled this permission and this tier; recording the facts a release rests on is the same authority as granting it",
  );
});

test("a forbidden admin records nothing", async () => {
  ctrl.gateOk = false;
  const POST = await loadPOST();
  const res = (await POST(
    req({ action: "RECORD_CLEARANCE_FACTS", reason: "Lender stipulations cleared", facts: { lenderConditionsCleared: true } }),
    { params },
  )) as unknown as { __kind: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.status, 403);
  assert.equal(ctrl.recordCalls.length, 0, "the gate must run before the write, not beside it");
});

test("PINNED OMISSION: a caller-supplied timestamp is REFUSED, not ignored", async () => {
  // The caller states WHETHER a fact holds; the service stamps WHEN. `facts` is `.strict()`
  // precisely so this cannot be smuggled in. Ignoring it would be worse than refusing: the
  // administrator would believe they had backdated the record and the screen would agree.
  const POST = await loadPOST();
  const res = (await POST(
    req({
      action: "RECORD_CLEARANCE_FACTS",
      reason: "Recording with a backdated timestamp",
      facts: { dealerFundingConfirmed: true, dealerFundingConfirmedAt: "2020-01-01T00:00:00Z" },
    }),
    { params },
  )) as unknown as { __kind: string; code: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.code, "VALIDATION_ERROR");
  assert.equal(res.status, 400);
  assert.equal(ctrl.recordCalls.length, 0, "nothing may be recorded from a body carrying a field the schema does not name");
});

test("the ≥10-character reason bar applies here too", async () => {
  const POST = await loadPOST();
  const res = (await POST(
    req({ action: "RECORD_CLEARANCE_FACTS", reason: "ok", facts: { dealerFundingConfirmed: true } }),
    { params },
  )) as unknown as { __kind: string; code: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.code, "VALIDATION_ERROR");
  assert.equal(ctrl.recordCalls.length, 0);
});

test("a recording passes the actor and reason through, and returns what it recorded", async () => {
  const POST = await loadPOST();
  const res = (await POST(
    req({
      action: "RECORD_CLEARANCE_FACTS",
      reason: "Lender stips cleared and dealership confirmed funding",
      facts: { lenderConditionsCleared: true, dealerFundingConfirmed: true },
    }),
    { params },
  )) as unknown as { __kind: string; data: { recorded: string[] } };

  assert.equal(res.__kind, "success");
  assert.deepEqual(res.data.recorded, ["lender_conditions"]);
  assert.equal(ctrl.recordCalls.length, 1);
  const call = ctrl.recordCalls[0]!;
  assert.equal(call.dealId, "deal_1");
  assert.equal(call.actorId, "adm_fin_1");
  assert.equal(call.actorEmail, "finance@autolenis.com");
  assert.match(String(call.reason), /Lender stips cleared/);
  assert.deepEqual(call.facts, { lenderConditionsCleared: true, dealerFundingConfirmed: true });
});

test("a withdrawal is expressible — false and null reach the service unchanged", async () => {
  const POST = await loadPOST();
  await POST(
    req({
      action: "RECORD_CLEARANCE_FACTS",
      reason: "Withdrawn — the confirmation was for a different deal",
      facts: { dealerFundingConfirmed: false, downPaymentMethod: null },
    }),
    { params },
  );
  assert.deepEqual(
    ctrl.recordCalls[0]!.facts,
    { dealerFundingConfirmed: false, downPaymentMethod: null },
    "a mis-recorded fact must be withdrawable through the route, or the only remedy is a hand-written database update",
  );
});

test("a service refusal maps to 409, not a 500", async () => {
  ctrl.recordThrows = new FundingClearanceError(
    "ALREADY_CLEARED",
    "Funding has already cleared for this deal.",
  );
  const POST = await loadPOST();
  const res = (await POST(
    req({ action: "RECORD_CLEARANCE_FACTS", reason: "Trying to amend a cleared deal", facts: { dealerFundingConfirmed: false } }),
    { params },
  )) as unknown as { __kind: string; code: string; status: number };

  assert.equal(res.__kind, "error");
  assert.equal(res.status, 409);
  assert.equal(res.code, "ALREADY_CLEARED");
});
