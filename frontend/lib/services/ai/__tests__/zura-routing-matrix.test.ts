// The Phase 2 §6.3 routing matrix, asserted against the code.
//
// Two questions, both of which the design answers in prose and neither of which
// prose can keep true:
//
//   1. Is every capability the matrix permits actually REACHABLE by exactly the
//      actors it names — and by no others?
//   2. Does everything in the before → after map still work?
//
// The catalog-backed rows (the ActionIntent capabilities) are checked through
// the real six-gate `authorize.ts` chain with an in-memory store, so a pass here
// means the gates admitted it, not that a table said they would.
//
//   pnpm test:zura

import test from "node:test";
import assert from "node:assert/strict";
import { proposeIntent } from "../action-intent/engine";
import {
  ACTION_INTENT_CATALOG,
  getIntentDefinition,
  listIntentsForActor,
  riskClassFor,
} from "../action-intent/catalog";
import { intentSliceFor } from "../zura-chat.service";
import type { ActorContext, ActorType, AuthenticatedRole, RiskClass } from "../action-intent/types";
import { makeDeps, makeActor } from "../action-intent/__tests__/_harness";

// ─── The matrix rows that are catalog capabilities ───────────────────────────
//
// Row numbers are Phase 2 §6.3's. Rows that are prompt-only answers, navigation
// or transport (1, 5, 6, 8, 9, 13, 15, 18, 20, 23, 25, 26, 31–33, 36–37) have no
// catalog entry by design and are covered elsewhere: isolation and prompt
// projection in `zura-isolation.test.ts`, the public intake path in
// `concierge-hardening.test.ts`.

interface MatrixRow {
  row: number;
  intentType: string;
  actorType: ActorType;
  /** Exactly the roles the matrix permits. Every other role must be rejected. */
  permitted: AuthenticatedRole[];
  riskClass: RiskClass;
  requiresHumanApproval: boolean;
  /** Rows the matrix marks as never executable at all. */
  neverExecutes?: boolean;
}

const ALL_ADMIN: AuthenticatedRole[] = [
  "SUPER_ADMIN",
  "OPERATIONS_ADMIN",
  "COMPLIANCE_ADMIN",
  "FINANCE_ADMIN",
  "SUPPORT_ADMIN",
];

const MATRIX: MatrixRow[] = [
  { row: 7, intentType: "buyer.get_journey_status", actorType: "BUYER", permitted: ["BUYER"], riskClass: "READ_ONLY", requiresHumanApproval: false },
  { row: 10, intentType: "buyer.create_vehicle_request", actorType: "BUYER", permitted: ["BUYER"], riskClass: "CONSEQUENTIAL", requiresHumanApproval: true },
  { row: 11, intentType: "buyer.select_offer", actorType: "BUYER", permitted: ["BUYER"], riskClass: "IRREVERSIBLE", requiresHumanApproval: true },
  { row: 14, intentType: "dealer.get_auction_invitations", actorType: "DEALER", permitted: ["DEALER"], riskClass: "READ_ONLY", requiresHumanApproval: false },
  { row: 16, intentType: "dealer.submit_offer", actorType: "DEALER", permitted: ["DEALER"], riskClass: "CONSEQUENTIAL", requiresHumanApproval: true },
  { row: 19, intentType: "affiliate.get_commission_summary", actorType: "AFFILIATE", permitted: ["AFFILIATE"], riskClass: "READ_ONLY", requiresHumanApproval: false },
  { row: 21, intentType: "affiliate.request_payout", actorType: "AFFILIATE", permitted: ["AFFILIATE"], riskClass: "IRREVERSIBLE", requiresHumanApproval: true, neverExecutes: true },
  { row: 24, intentType: "admin.get_platform_snapshot", actorType: "ADMIN", permitted: ALL_ADMIN, riskClass: "READ_ONLY", requiresHumanApproval: false },
  { row: 27, intentType: "admin.advance_deal_status", actorType: "ADMIN", permitted: ALL_ADMIN, riskClass: "CONSEQUENTIAL", requiresHumanApproval: true },
  { row: 28, intentType: "admin.extend_auction", actorType: "ADMIN", permitted: ALL_ADMIN, riskClass: "CONSEQUENTIAL", requiresHumanApproval: true },
  { row: 29, intentType: "admin.trigger_deposit_refund", actorType: "ADMIN", permitted: ALL_ADMIN, riskClass: "IRREVERSIBLE", requiresHumanApproval: true },
  // Rows 12 / 17 / 22 / 30 are the SAME shared escalation intent, reachable by
  // all four self-service actor populations.
  { row: 12, intentType: "system.escalate_to_human", actorType: "SYSTEM", permitted: ["BUYER", "DEALER", "AFFILIATE", ...ALL_ADMIN], riskClass: "LOW_RISK_MUTATION", requiresHumanApproval: false },
];

const ALL_ROLES: AuthenticatedRole[] = ["BUYER", "DEALER", "AFFILIATE", ...ALL_ADMIN];

// ─── The declared shape matches the catalog ──────────────────────────────────

for (const m of MATRIX) {
  test(`row ${m.row}: ${m.intentType} exists with the declared actor, risk class and approval`, () => {
    const def = getIntentDefinition(m.intentType);
    assert.ok(def, `${m.intentType} is not in the catalog — a matrix row is unreachable`);
    assert.equal(def.actorType, m.actorType);
    assert.equal(riskClassFor(def), m.riskClass);
    assert.equal(def.requiresHumanApproval, m.requiresHumanApproval);
    assert.deepEqual([...def.permittedRoles].sort(), [...m.permitted].sort());
  });
}

test("the catalog contains no intent the matrix does not account for", () => {
  const accounted = new Set(MATRIX.map((m) => m.intentType));
  const unaccounted = Object.keys(ACTION_INTENT_CATALOG).filter((t) => !accounted.has(t));
  assert.deepEqual(unaccounted, [], "an intent exists that no matrix row governs");
});

// ─── Reachable by exactly the permitted actors, and no others ────────────────

for (const m of MATRIX) {
  if (m.neverExecutes) continue;

  test(`row ${m.row}: ${m.intentType} is REACHABLE by each permitted role`, async () => {
    for (const role of m.permitted) {
      const deps = makeDeps({ activeIntents: [m.intentType] });
      const actorType = m.actorType === "SYSTEM" ? actorTypeForRole(role) : m.actorType;
      const actorId = harnessActorId(actorType);
      const actor: ActorContext = makeActor({ actorType, actorId, authenticatedRole: role });
      const out = await proposeIntent(
        { intentType: m.intentType, parameters: paramsFor(m.intentType, actorId), actor },
        deps,
      );
      assert.notEqual(
        out.status,
        "REJECTED",
        `${role} should reach ${m.intentType} but got ${out.status === "REJECTED" ? out.code : out.status}`,
      );
    }
  });

  test(`row ${m.row}: ${m.intentType} is UNREACHABLE by every other role`, async () => {
    const denied = ALL_ROLES.filter((r) => !m.permitted.includes(r));
    for (const role of denied) {
      const deps = makeDeps({ activeIntents: [m.intentType] });
      const actorType = actorTypeForRole(role);
      const actorId = harnessActorId(actorType);
      const actor: ActorContext = makeActor({ actorType, actorId, authenticatedRole: role });
      const out = await proposeIntent(
        { intentType: m.intentType, parameters: paramsFor(m.intentType, actorId), actor },
        deps,
      );
      assert.equal(out.status, "REJECTED", `${role} must not reach ${m.intentType}`);
      assert.ok(
        out.status === "REJECTED" &&
          (out.code === "UNAUTHORIZED_ACTOR" || out.code === "UNAUTHORIZED_ROLE"),
        `${role} → ${m.intentType} rejected with the wrong code: ${out.status === "REJECTED" ? out.code : ""}`,
      );
      assert.deepEqual(deps.calls, [], "a rejected proposal must have ZERO side effects");
    }
  });
}

test("row 21: affiliate.request_payout NEVER executes, even when activated", async () => {
  const deps = makeDeps({ activeIntents: ["affiliate.request_payout"] });
  const out = await proposeIntent(
    {
      intentType: "affiliate.request_payout",
      parameters: paramsFor("affiliate.request_payout", "affiliate-1"),
      actor: makeActor({ actorType: "AFFILIATE", actorId: "affiliate-1", authenticatedRole: "AFFILIATE" }),
    },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNAVAILABLE_INTENT");
  assert.deepEqual(deps.calls, [], "the human Finance Hub rail stays live; the AI path is closed");
});

// ─── Admin role scoping (§5.5) ───────────────────────────────────────────────

test("a SUPPORT_ADMIN cannot even NAME an intent requiring finance.refunds", () => {
  const slice = intentSliceFor({
    actorType: "ADMIN",
    actorId: "adm-support",
    authenticatedRole: "SUPPORT_ADMIN",
  });
  const names = slice.map((d) => d.type);
  assert.ok(!names.includes("admin.trigger_deposit_refund"));
  // …while the aggregate-only read stays available to every admin role.
  assert.ok(names.includes("admin.get_platform_snapshot"));
});

test("a FINANCE_ADMIN CAN name the refund intent", () => {
  const names = intentSliceFor({
    actorType: "ADMIN",
    actorId: "adm-fin",
    authenticatedRole: "FINANCE_ADMIN",
  }).map((d) => d.type);
  assert.ok(names.includes("admin.trigger_deposit_refund"));
});

test("a SUPPORT_ADMIN cannot name crm.manage intents either", () => {
  const names = intentSliceFor({
    actorType: "ADMIN",
    actorId: "adm-support",
    authenticatedRole: "SUPPORT_ADMIN",
  }).map((d) => d.type);
  assert.ok(!names.includes("admin.advance_deal_status"));
  assert.ok(!names.includes("admin.extend_auction"));
});

test("scoping the NAMEABLE slice is defence in depth — the gates reject anyway", async () => {
  // A SUPPORT_ADMIN who somehow emitted the refund intent is still stopped, by
  // approval permission, at the point it would matter.
  const deps = makeDeps({ activeIntents: ["admin.trigger_deposit_refund"] });
  const out = await proposeIntent(
    {
      intentType: "admin.trigger_deposit_refund",
      parameters: paramsFor("admin.trigger_deposit_refund", "admin-1"),
      actor: makeActor({ actorType: "ADMIN", actorId: "adm-support", authenticatedRole: "SUPPORT_ADMIN" }),
    },
    deps,
  );
  // The catalog permits every admin role to PROPOSE; approval is where the
  // finance.refunds permission binds, so the proposal halts un-executed.
  assert.equal(out.status, "APPROVAL_REQUIRED");
  assert.deepEqual(deps.calls, [], "nothing executes from a proposal alone");
});

test("the non-admin intent slice is not filtered by approver permission", () => {
  for (const actorType of ["BUYER", "DEALER", "AFFILIATE"] as const) {
    const slice = intentSliceFor({
      actorType,
      actorId: "x",
      authenticatedRole: actorType,
    });
    assert.deepEqual(
      slice.map((d) => d.type).sort(),
      listIntentsForActor(actorType).map((d) => d.type).sort(),
    );
  }
});

test("an actor with no authenticated role can name NOTHING", () => {
  assert.deepEqual(
    intentSliceFor({ actorType: "SYSTEM", actorId: "anon", authenticatedRole: null }),
    [],
  );
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * The ids the shared harness's permissive policy deps are keyed on. Using them
 * means an OWNERSHIP_DENIED result is a genuine policy finding, not an artefact
 * of a fixture that never owned the record in the first place.
 */
function harnessActorId(actorType: ActorType): string {
  switch (actorType) {
    case "BUYER":
      return "buyer-1";
    case "DEALER":
      return "dealer-1";
    case "AFFILIATE":
      return "affiliate-1";
    default:
      return "admin-1";
  }
}

function actorTypeForRole(role: AuthenticatedRole): ActorType {
  if (role === "BUYER") return "BUYER";
  if (role === "DEALER") return "DEALER";
  if (role === "AFFILIATE") return "AFFILIATE";
  return "ADMIN";
}

/** Valid parameters per intent, so a rejection is never merely a schema failure. */
function paramsFor(intentType: string, actorId: string): Record<string, unknown> {
  switch (intentType) {
    case "buyer.create_vehicle_request":
      return {
        makePreference: "Toyota",
        modelPreference: "Highlander",
        maxBudgetCents: 4_000_000,
      };
    case "buyer.select_offer":
      return { auctionId: "auction-1", offerId: "offer-1" };
    case "dealer.submit_offer":
      return {
        auctionId: "auction-1",
        otdPriceCents: 3_900_000,
        vehiclePriceCents: 3_500_000,
        taxCents: 300_000,
        feesCents: 100_000,
      };
    case "admin.advance_deal_status":
      return { dealId: "deal-1", newStatus: "FINANCING_PENDING", reason: "financing docs verified" };
    case "admin.extend_auction":
      return { auctionId: "auction-1", hours: 12, reason: "low offer count near close" };
    case "admin.trigger_deposit_refund":
      return { depositId: "dep-1", reason: "no competitive offer received" };
    case "affiliate.request_payout":
      return { amountCents: 5000 };
    case "system.escalate_to_human":
      return {
        summary: "The buyer asked something outside my catalog.",
        onBehalfOfActorType: "BUYER",
        onBehalfOfActorId: actorId,
      };
    default:
      return {};
  }
}
