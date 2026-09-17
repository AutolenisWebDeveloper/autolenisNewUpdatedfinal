// §24 — THE BUYER'S OWN CANCELLATION GOES THROUGH THE ONE ORCHESTRATION.
//
// This route wrote `vehicleRequest.update({ status: CANCELLED })` directly — the identical
// second-writer shape Phase 10 removed from the admin command centre, with the identical
// consequence: none of §24's stops ran. A buyer cancelling at ACTIVE_SOURCING left the
// sourcing case OPEN, so `coverage-hold-reconcile` → `sweepSourcingCases` kept driving a
// request its owner had ended, and any queued transactional comms stayed queued.
//
// What these pin is the pair of properties that make the delegation safe: the route's own
// precondition still refuses first (the orchestration's stop is WIDER and would otherwise
// grant buyers a capability this route never had), and the outcome is REPORTED rather than
// assumed.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/requests/__tests__/cancel-route.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

type Rec = Record<string, unknown>;

let requestRow: { id: string; status: string } | null;
let cancelCalls: Rec[];
let cancelOutcome: "CANCELLED" | "FROZEN_PENDING_RELEASE" | "NOT_MOVED";
let rawRequestWrites: Rec[];
let events: Rec[];

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "buyer_1" }),
    successResponse: (data: Rec) => ({ ok: true, data }),
    errorResponse: (code: string, message: string, status: number) => ({ ok: false, code, message, status }),
  },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findFirst: async () => requestRow,
        // Any direct status write from this route is the defect.
        update: async (a: { data: Rec }) => { rawRequestWrites.push(a.data); return {}; },
        updateMany: async (a: { data: Rec }) => { rawRequestWrites.push(a.data); return { count: 1 }; },
      },
      vehicleRequestEvent: { create: async (a: { data: Rec }) => { events.push(a.data); return {}; } },
    },
  },
});

mock.module("@/lib/services/transaction/cancellation.service", {
  namedExports: {
    cancelTransaction: async (input: Rec) => {
      cancelCalls.push(input);
      return {
        outcome: cancelOutcome,
        stageAtCancellation: "VehicleRequest ACTIVE_SOURCING",
        stops: [],
        vehicleRequestId: input.vehicleRequestId,
      };
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { error: () => {}, warn: () => {}, info: () => {} } } });

beforeEach(() => {
  requestRow = { id: "vr_1", status: "ACTIVE_SOURCING" };
  cancelCalls = [];
  cancelOutcome = "CANCELLED";
  rawRequestWrites = [];
  events = [];
});

async function post() {
  const { POST } = await import("@/app/api/buyer/requests/[requestId]/cancel/route");
  return POST({} as never, { params: Promise.resolve({ requestId: "vr_1" }) });
}

test("the buyer's cancellation runs §24's stops — never a raw status write", async () => {
  const res = (await post()) as unknown as { ok: boolean; data: Rec };

  assert.deepEqual(
    rawRequestWrites,
    [],
    "a direct `vehicleRequest.update` skips every stop: the sourcing case stays open, the " +
      "queued comms stay queued, and no reason is recorded",
  );
  assert.equal(cancelCalls.length, 1);
  assert.equal(cancelCalls[0]!.vehicleRequestId, "vr_1");
  assert.equal(cancelCalls[0]!.actorRole, "BUYER");
  assert.equal(cancelCalls[0]!.actorId, "buyer_1");
  assert.ok(res.ok);
  assert.equal(res.data.cancelled, true);
});

test("§24 requires a reason, and this route supplies a real one", async () => {
  await post();
  const reason = cancelCalls[0]!.reason as string;
  assert.ok(reason && reason.trim().length > 10, "a column that is always null is the same as no column");
  assert.match(reason, /buyer/i, "the record should say WHO ended it and from where");
});

test("the route's OWN precondition still refuses first — the delegation grants nothing new", async () => {
  // The orchestration's VEHICLE_REQUEST stop accepts anything not already CANCELLED / EXPIRED /
  // CLOSED_NO_MATCH / DEAL_CREATED, which is wider than this route has ever accepted. Delegating
  // without this check would hand buyers a capability by refactor.
  requestRow = { id: "vr_1", status: "OFFERS_READY" };
  const res = (await post()) as unknown as { ok: boolean; code: string; status: number };

  assert.equal(res.ok, false);
  assert.equal(res.code, "CANNOT_CANCEL");
  assert.equal(res.status, 400);
  assert.deepEqual(cancelCalls, [], "and the orchestration is not even reached");
});

test("a request that is not this buyer's is a 404, before anything is cancelled", async () => {
  requestRow = null;
  const res = (await post()) as unknown as { ok: boolean; code: string };
  assert.equal(res.code, "NOT_FOUND");
  assert.deepEqual(cancelCalls, []);
});

test("an outcome the orchestration DECLINED is reported, never as success", async () => {
  cancelOutcome = "NOT_MOVED";
  const res = (await post()) as unknown as { ok: boolean; data: Rec };

  assert.equal(res.data.cancelled, false, "a buyer told 'cancelled' about a live request acts on a false state");
  assert.equal(res.data.outcome, "NOT_MOVED");
});

test("the buyer-facing audit row is still written, with the real actor", async () => {
  await post();
  assert.equal(events.length, 1);
  assert.equal(events[0]!.eventType, "CANCELLED");
  assert.equal(events[0]!.actorRole, "BUYER");
  assert.equal(events[0]!.actorId, "buyer_1");
});
