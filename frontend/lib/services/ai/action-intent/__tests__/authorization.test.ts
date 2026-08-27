// Fail-closed authorization. Every rejection must produce ZERO side effects
// (no command call) and a typed rejection code.
//
//   npx tsx --test lib/services/ai/action-intent/__tests__/authorization.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import { proposeIntent } from "../engine";
import { authorizeProposal } from "../authorize";
import { makeActor, makeDeps } from "./_harness";

test("unknown intent → rejected, no execution", async () => {
  const deps = makeDeps({ activeIntents: [] });
  const out = await proposeIntent(
    { intentType: "buyer.totally_made_up", parameters: {}, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNKNOWN_INTENT");
  assert.deepEqual(deps.calls, []);
});

test("unmapped model string is NOT coerced to the nearest command", async () => {
  const deps = makeDeps({ activeIntents: [] });
  // A plausible-looking but non-catalog string must not map to buyer.select_offer.
  const out = await proposeIntent(
    { intentType: "buyer.selectOffer", parameters: { auctionId: "a", offerId: "o" }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNKNOWN_INTENT");
  assert.deepEqual(deps.calls, []);
});

test("unavailable intent (gated-off dependency) never executes, even if activated", async () => {
  const deps = makeDeps({ activeIntents: ["affiliate.request_payout"] });
  const out = await proposeIntent(
    {
      intentType: "affiliate.request_payout",
      parameters: { amountCents: 5000 },
      actor: makeActor({ actorType: "AFFILIATE", actorId: "aff-1", authenticatedRole: "AFFILIATE" }),
    },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNAVAILABLE_INTENT");
  assert.deepEqual(deps.calls, []);
});

test("unauthorized actor surface → rejected", async () => {
  const deps = makeDeps({ activeIntents: ["dealer.get_auction_invitations"] });
  // A BUYER agent tries to propose a DEALER intent.
  const out = await proposeIntent(
    { intentType: "dealer.get_auction_invitations", parameters: {}, actor: makeActor({ actorType: "BUYER" }) },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNAUTHORIZED_ACTOR");
  assert.deepEqual(deps.calls, []);
});

test("unauthorized role → rejected", async () => {
  const deps = makeDeps({ activeIntents: ["admin.get_platform_snapshot"] });
  // ADMIN surface but a non-admin authenticated role.
  const out = await proposeIntent(
    {
      intentType: "admin.get_platform_snapshot",
      parameters: {},
      actor: makeActor({ actorType: "ADMIN", actorId: "x", authenticatedRole: "BUYER" }),
    },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "UNAUTHORIZED_ROLE");
  assert.deepEqual(deps.calls, []);
});

test("malformed parameters → rejected", async () => {
  const deps = makeDeps({ activeIntents: ["buyer.select_offer"] });
  const out = await proposeIntent(
    { intentType: "buyer.select_offer", parameters: { auctionId: "a" /* missing offerId */ }, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "MALFORMED_PARAMETERS");
  assert.deepEqual(deps.calls, []);
});

test("extra/unknown parameter keys are rejected (strict schema)", async () => {
  const deps = makeDeps({ activeIntents: ["buyer.select_offer"] });
  const out = await proposeIntent(
    {
      intentType: "buyer.select_offer",
      parameters: { auctionId: "a", offerId: "o", force: true, adminOverride: true },
      actor: makeActor(),
    },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "MALFORMED_PARAMETERS");
  assert.deepEqual(deps.calls, []);
});

test("disabled (not activated) intent → rejected fail-closed", async () => {
  const deps = makeDeps({ activeIntents: [] }); // dormant
  const out = await proposeIntent(
    { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "REJECTED");
  assert.equal(out.status === "REJECTED" && out.code, "NOT_ACTIVATED");
  assert.deepEqual(deps.calls, []);
});

test("authorized + activated read reaches execution", async () => {
  const deps = makeDeps({ activeIntents: ["buyer.get_journey_status"] });
  const out = await proposeIntent(
    { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor() },
    deps,
  );
  assert.equal(out.status, "COMPLETED");
  assert.deepEqual(deps.calls, ["buyer.get_journey_status"]);
});

test("authorizeProposal is pure: no activation → not ok, unknown → not ok", async () => {
  const closed = { activation: async () => false };
  const r1 = await authorizeProposal(
    { intentType: "buyer.get_journey_status", parameters: {}, actor: makeActor() },
    closed,
  );
  assert.equal(r1.ok, false);
  assert.equal(r1.ok === false && r1.code, "NOT_ACTIVATED");

  const r2 = await authorizeProposal(
    { intentType: "nope", parameters: {}, actor: makeActor() },
    { activation: async () => true },
  );
  assert.equal(r2.ok, false);
  assert.equal(r2.ok === false && r2.code, "UNKNOWN_INTENT");
});
