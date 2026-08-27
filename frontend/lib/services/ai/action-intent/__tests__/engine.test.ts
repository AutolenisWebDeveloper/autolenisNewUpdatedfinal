// Engine behavior: approval boundary, no-execution-from-proposal, self-approval
// prohibition, server-authoritative approval, replay/idempotency, policy denial
// with zero side effects, truthfulness, and human escalation.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/engine.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { proposeIntent, approveIntent, rejectIntent, describeOutcomeForAgent } from "../engine";
import { makeActor, makeDeps, permissivePolicyDeps } from "./_harness";

const adminActor = (id = "admin-1") => makeActor({ actorType: "ADMIN", actorId: id, authenticatedRole: "OPERATIONS_ADMIN", actorEmail: "a@x.com" });

test("consequential intent stops at APPROVAL_REQUIRED — no execution from the proposal", async () => {
  const deps = makeDeps({ activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor() },
    deps,
  );
  assert.equal(out.status, "APPROVAL_REQUIRED");
  assert.deepEqual(deps.calls, []); // NOTHING executed
  assert.ok(deps.audit.statuses().includes("APPROVAL_REQUIRED"));
  assert.ok(!deps.audit.statuses().includes("COMPLETED"));
});

test("the AI/system actor can NEVER approve its own proposal", async () => {
  const deps = makeDeps({ activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor() },
    deps,
  );
  assert.equal(out.status, "APPROVAL_REQUIRED");
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // The agent runs as SYSTEM — an approval from SYSTEM is forbidden.
  await assert.rejects(
    () => approveIntent(intentId, makeActor({ actorType: "SYSTEM", actorId: "zura", authenticatedRole: "OPERATIONS_ADMIN" }), deps),
    /never approve/i,
  );
  assert.deepEqual(deps.calls, []);
});

test("a non-admin cannot approve an admin-scoped consequential intent", async () => {
  const deps = makeDeps({ activeIntents: ["admin.trigger_deposit_refund"], policyDeps: permissivePolicyDeps() });
  const out = await proposeIntent(
    { intentType: "admin.trigger_deposit_refund", parameters: { depositId: "dep1", reason: "duplicate charge" }, actor: adminActor() },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  await assert.rejects(
    () => approveIntent(intentId, makeActor({ actorType: "BUYER", actorId: "b", authenticatedRole: "BUYER" }), deps),
    /APPROVER_NOT_PERMITTED|admin/i,
  );
  assert.deepEqual(deps.calls, []);
});

test("server-authoritative human approval executes the canonical command", async () => {
  const deps = makeDeps({ activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const approved = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(approved.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["admin.advance_deal_status"]);
  const s = deps.audit.statuses();
  assert.ok(s.includes("APPROVED") && s.includes("COMPLETED"));
});

test("buyer self-confirmation is a valid server-authoritative approval", async () => {
  const deps = makeDeps({ activeIntents: ["buyer.select_offer"] });
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "auction-1", offerId: "offer-1" }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "APPROVAL_REQUIRED");
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // The SAME authenticated buyer confirms via a server action (not chat text).
  const approved = await approveIntent(intentId, makeActor(), deps);
  assert.equal(approved.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["buyer.select_offer"]);
});

test("double approval cannot execute twice (replay/idempotency)", async () => {
  const deps = makeDeps({ activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const first = await approveIntent(intentId, adminActor("admin-2"), deps);
  const second = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(first.status, "COMPLETED");
  assert.equal(second.status, "COMPLETED"); // idempotent read of terminal state
  assert.deepEqual(deps.calls, ["admin.advance_deal_status"]); // executed exactly ONCE
});

test("duplicate proposal with same idempotency key collapses to one record", async () => {
  const deps = makeDeps({ activeIntents: ["buyer.get_journey_status"] });
  const p = { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor(), idempotencyKey: "k-1" };
  const a = await proposeIntent(p, deps);
  const b = await proposeIntent(p, deps);
  assert.equal(a.status, "COMPLETED");
  assert.equal(b.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["buyer.get_journey_status"]); // executed exactly ONCE
});

test("policy denial produces zero side effects", async () => {
  // Force the money gate closed: fulfillment not unlocked.
  const deps = makeDeps({
    activeIntents: ["buyer.select_offer"],
    policyDeps: permissivePolicyDeps({ isFulfillmentUnlocked: async () => false }),
  });
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "auction-1", offerId: "offer-1" }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "POLICY_DENIED");
  assert.deepEqual(deps.calls, []);
});

test("IDOR: buyer cannot select an offer from another buyer's auction", async () => {
  const deps = makeDeps({
    activeIntents: ["buyer.select_offer"],
    policyDeps: permissivePolicyDeps({
      getOfferContext: async () => ({ auctionId: "auction-9", auctionBuyerId: "someone-else", auctionStatus: "ACTIVE", offerStatus: "SUBMITTED" }),
    }),
  });
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "auction-9", offerId: "offer-1" }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "OWNERSHIP_DENIED");
  assert.deepEqual(deps.calls, []);
});

test("a rejected pending approval never executes", async () => {
  const deps = makeDeps({ activeIntents: ["admin.extend_auction"] });
  const out = await proposeIntent(
    { intentType: "admin.extend_auction", parameters: { auctionId: "a1", hours: 12, reason: "buyer travel" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const rejected = await rejectIntent(intentId, adminActor("admin-2"), "not warranted", deps);
  assert.equal(rejected.status, "REJECTED");
  assert.deepEqual(deps.calls, []);
  // A later approval attempt on a rejected record cannot execute.
  const late = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(late.status, "REJECTED");
  assert.deepEqual(deps.calls, []);
});

test("failed command → FAILED status, never COMPLETED", async () => {
  const deps = makeDeps({
    activeIntents: ["buyer.get_journey_status"],
    commandResult: () => ({ ok: false, failureReason: "boom" }),
  });
  const out = await proposeIntent(
    { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "FAILED");
});

test("truthfulness: completion language derives ONLY from authoritative status", () => {
  assert.match(describeOutcomeForAgent({ status: "APPROVAL_REQUIRED", intentId: "i" }), /awaiting human approval|not been executed/i);
  assert.match(describeOutcomeForAgent({ status: "COMPLETED", intentId: "i" }), /completed/i);
  assert.doesNotMatch(describeOutcomeForAgent({ status: "APPROVAL_REQUIRED", intentId: "i" }), /completed/i);
  assert.match(describeOutcomeForAgent({ status: "FAILED", intentId: "i", failureReason: "x" }), /did not go through/i);
  assert.match(describeOutcomeForAgent({ status: "REJECTED", code: "POLICY_DENIED", message: "no" }), /can't do that|escalate/i);
});

test("human escalation is available to any actor and executes safely", async () => {
  const deps = makeDeps({ activeIntents: ["system.escalate_to_human"] });
  const out = await proposeIntent(
    {
      intentType: "system.escalate_to_human",
      parameters: { summary: "Buyer confused about deposit", onBehalfOfActorType: "BUYER", onBehalfOfActorId: "buyer-1" },
      actor: makeActor(),
    },
    deps,
  );
  assert.equal(out.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["system.escalate_to_human"]);
});

test("DEFECT-1: a SUPPORT_ADMIN cannot approve a money refund (finance.refunds = SUPER/FINANCE only)", async () => {
  const deps = makeDeps({ activeIntents: ["admin.trigger_deposit_refund"] });
  const out = await proposeIntent(
    { intentType: "admin.trigger_deposit_refund", parameters: { depositId: "dep1", reason: "duplicate charge" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  // OPERATIONS_ADMIN lacks finance.refunds → rejected.
  await assert.rejects(
    () => approveIntent(intentId, makeActor({ actorType: "ADMIN", actorId: "ops-9", authenticatedRole: "OPERATIONS_ADMIN" }), deps),
    /permission "finance.refunds"|APPROVER_NOT_PERMITTED/i,
  );
  // SUPPORT_ADMIN also lacks it → rejected.
  await assert.rejects(
    () => approveIntent(intentId, makeActor({ actorType: "ADMIN", actorId: "sup-9", authenticatedRole: "SUPPORT_ADMIN" }), deps),
    /finance.refunds|APPROVER_NOT_PERMITTED/i,
  );
  assert.deepEqual(deps.calls, []); // never executed by an under-permissioned approver
});

test("DEFECT-1: a FINANCE_ADMIN CAN approve a money refund", async () => {
  const deps = makeDeps({ activeIntents: ["admin.trigger_deposit_refund"] });
  const out = await proposeIntent(
    { intentType: "admin.trigger_deposit_refund", parameters: { depositId: "dep1", reason: "duplicate charge" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const approved = await approveIntent(intentId, makeActor({ actorType: "ADMIN", actorId: "fin-2", authenticatedRole: "FINANCE_ADMIN" }), deps);
  assert.equal(approved.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["admin.trigger_deposit_refund"]);
});

test("DEFECT-4: concurrent double-approval returns idempotently and executes exactly once", async () => {
  const deps = makeDeps({ activeIntents: ["admin.advance_deal_status"] });
  const out = await proposeIntent(
    { intentType: "admin.advance_deal_status", parameters: { dealId: "d1", newStatus: "FEE_PENDING" }, actor: adminActor("admin-1") },
    deps,
  );
  const intentId = out.status === "APPROVAL_REQUIRED" ? out.intentId : "";
  const [a, b] = await Promise.all([
    approveIntent(intentId, adminActor("admin-2"), deps),
    approveIntent(intentId, adminActor("admin-3"), deps),
  ]);
  // Neither throws; the command ran EXACTLY once; the winner is COMPLETED and
  // the loser observes a truthful in-flight/terminal state — never a second run,
  // never REJECTED/FAILED, never a mislabelled "awaiting approval".
  assert.deepEqual(deps.calls, ["admin.advance_deal_status"]);
  const statuses = [a.status, b.status];
  assert.ok(statuses.includes("COMPLETED"), `expected a COMPLETED, got ${statuses.join(",")}`);
  for (const s of statuses) assert.ok(["COMPLETED", "EXECUTING"].includes(s), `unexpected ${s}`);
  // The record itself must end COMPLETED.
  const finalOut = await approveIntent(intentId, adminActor("admin-2"), deps);
  assert.equal(finalOut.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["admin.advance_deal_status"]); // still once
});

test("escalation ownership: a buyer cannot escalate on another principal's behalf", async () => {
  const deps = makeDeps({ activeIntents: ["system.escalate_to_human"] });
  const out = await proposeIntent(
    {
      intentType: "system.escalate_to_human",
      parameters: { summary: "please help me", onBehalfOfActorType: "BUYER", onBehalfOfActorId: "another-buyer" },
      actor: makeActor(),
    },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "OWNERSHIP_DENIED");
  assert.deepEqual(deps.calls, []);
});
