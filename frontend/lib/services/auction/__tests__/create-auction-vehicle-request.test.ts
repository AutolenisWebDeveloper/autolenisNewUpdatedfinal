// C1 — Auction.vehicleRequestId. createAuction threads an optional vehicleRequestId
// onto the new auction (the admin launch path supplies it; the deposit-activation
// reconciler does not, so it must stay optional/null). resolveOwnedVehicleRequestId
// is the buyer-ownership guard: it returns the id ONLY when the VehicleRequest
// belongs to the same buyer, so a mistyped/hostile id can never link an auction to
// another buyer's request.
//
// Run: pnpm test

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  created: [] as Array<Record<string, unknown>>,
  ownedVr: null as { id: string } | null,
  findFirstArgs: null as Record<string, unknown> | null,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.created.push(data);
          return { id: "auc_1", ...data };
        },
      },
      vehicleRequest: {
        findFirst: async (args: Record<string, unknown>) => {
          state.findFirstArgs = args;
          return state.ownedVr;
        },
      },
    },
  },
});

beforeEach(() => {
  state.created = [];
  state.ownedVr = null;
  state.findFirstArgs = null;
});

test("createAuction stores vehicleRequestId when provided", async () => {
  const { createAuction } = await import("@/lib/services/auction/auction.service");
  await createAuction("buyer_1", "dep_1", "vr_1");
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0]!.buyerId, "buyer_1");
  assert.equal(state.created[0]!.depositId, "dep_1");
  assert.equal(state.created[0]!.vehicleRequestId, "vr_1");
});

test("createAuction omits vehicleRequestId when not provided (reconciler path)", async () => {
  const { createAuction } = await import("@/lib/services/auction/auction.service");
  await createAuction("buyer_1", "dep_1");
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0]!.vehicleRequestId, undefined);
});

test("resolveOwnedVehicleRequestId returns the id when the VR belongs to the buyer", async () => {
  const { resolveOwnedVehicleRequestId } = await import("@/lib/services/auction/auction.service");
  state.ownedVr = { id: "vr_1" };
  const resolved = await resolveOwnedVehicleRequestId("buyer_1", "vr_1");
  assert.equal(resolved, "vr_1");
  // The ownership scope is enforced in the query (id + buyerId), not in app logic.
  const where = state.findFirstArgs!.where as Record<string, unknown>;
  assert.equal(where.id, "vr_1");
  assert.equal(where.buyerId, "buyer_1");
});

test("resolveOwnedVehicleRequestId returns null when the VR is not the buyer's", async () => {
  const { resolveOwnedVehicleRequestId } = await import("@/lib/services/auction/auction.service");
  state.ownedVr = null; // findFirst(id+buyerId) misses → not owned
  const resolved = await resolveOwnedVehicleRequestId("buyer_1", "vr_other");
  assert.equal(resolved, null);
});

test("resolveOwnedVehicleRequestId short-circuits to null for an absent id (no query)", async () => {
  const { resolveOwnedVehicleRequestId } = await import("@/lib/services/auction/auction.service");
  const resolved = await resolveOwnedVehicleRequestId("buyer_1", undefined);
  assert.equal(resolved, null);
  assert.equal(state.findFirstArgs, null, "no DB round-trip when no id is supplied");
});
