// Revalidation before execution. Approval is NOT a licence to run stale work:
// every material condition is deterministically re-checked immediately before
// the canonical command, against CURRENT authoritative state. A proposal valid
// at creation but invalid at execution fails closed with ZERO consequential
// execution and a truthful FAILED state.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/revalidation.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { proposeIntent, approveIntent, type EngineDeps } from "../engine";
import { InMemoryActionIntentStore } from "../store";
import { activationKeyFor, capturingAudit, makeActor, permissivePolicyDeps, recordingCommands } from "./_harness";
import type { PolicyDeps } from "../types";

// Deps with MUTABLE activation + policy so a test can change authoritative state
// between proposal and approval/execution.
function mutableDeps(active: Set<string>, policyDeps: PolicyDeps) {
  const rec = recordingCommands();
  const audit = capturingAudit();
  let counter = 0;
  const deps: EngineDeps & { calls: string[]; audit: typeof audit } = {
    store: new InMemoryActionIntentStore(),
    audit,
    activation: async (key: string) => active.has(key),
    policyDeps,
    commands: rec.commands,
    genId: () => `id-${++counter}`,
    calls: rec.calls,
  } as EngineDeps & { calls: string[]; audit: typeof audit };
  return deps;
}

const adminActor = (id = "admin-1") => makeActor({ actorType: "ADMIN", actorId: id, authenticatedRole: "OPERATIONS_ADMIN" });

test("stale ACTIVATION: intent deactivated between approval-required and execution → FAILED, zero execution", async () => {
  const active = new Set([activationKeyFor("admin.advance_deal_status")]);
  const deps = mutableDeps(active, permissivePolicyDeps());
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // Owner deactivates the intent before the human approves.
  active.clear();
  const result = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(result.status, "FAILED");
  assert.match(result.status === "FAILED" ? (result.failureReason ?? "") : "", /revalidation/i);
  assert.deepEqual(deps.calls, []); // canonical command never invoked
});

test("stale POLICY / money gate: fulfillment revoked before execution → FAILED, zero execution", async () => {
  let unlocked = true;
  const policy = permissivePolicyDeps({ isFulfillmentUnlocked: async () => unlocked });
  const active = new Set([activationKeyFor("buyer.select_offer")]);
  const deps = mutableDeps(active, policy);
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "auction-1", offerId: "offer-1" }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "APPROVAL_REQUIRED");
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // The deposit gets refunded (fulfillment re-locks) before the buyer confirms.
  unlocked = false;
  const result = await approveIntent(intentId, makeActor(), deps);
  assert.equal(result.status, "FAILED");
  assert.deepEqual(deps.calls, []);
});

test("stale OWNERSHIP: offer reassigned to another buyer's auction before execution → FAILED", async () => {
  let ownerId = "buyer-1";
  const policy = permissivePolicyDeps({
    getOfferContext: async () => ({ auctionId: "auction-1", auctionBuyerId: ownerId, auctionStatus: "ACTIVE", offerStatus: "SUBMITTED" }),
  });
  const active = new Set([activationKeyFor("buyer.select_offer")]);
  const deps = mutableDeps(active, policy);
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "auction-1", offerId: "offer-1" }, actor: makeActor() },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  ownerId = "someone-else"; // authoritative state changed
  const result = await approveIntent(intentId, makeActor(), deps);
  assert.equal(result.status, "FAILED");
  assert.deepEqual(deps.calls, []);
});

test("no staleness: a still-valid approved intent executes normally", async () => {
  const active = new Set([activationKeyFor("admin.advance_deal_status")]);
  const deps = mutableDeps(active, permissivePolicyDeps());
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const result = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["admin.advance_deal_status"]);
  // The FAILED-on-revalidation path also emits a truthful audit trail.
  assert.ok(deps.audit.statuses().includes("EXECUTING"));
});
