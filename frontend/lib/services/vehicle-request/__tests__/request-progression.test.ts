// Batch 3 — automatic VehicleRequest progression SUBMITTED → INTAKE → ACTIVE_SOURCING.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/vehicle-request/__tests__/request-progression.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

interface Req { status: string; makePreference: string | null; modelPreference: string | null; notes: string | null; buyer: { zip: string | null } | null }
let req: Req;
const events: Array<Record<string, unknown>> = [];
const matchCalls: string[] = [];
const coverageCalls: string[] = [];
let matchBehavior: "ok" | "throw" = "ok";
let coverageBehavior: "ok" | "held" | "throw" = "ok";
// When set to a status, the next updateMany transitioning FROM it "loses the race":
// it returns count:0 but the row has already been advanced by the (simulated)
// winner — exercising the service's re-read branch.
let loseRaceFor: string | null = null;

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findUnique: async () => req,
        updateMany: async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
          if (loseRaceFor && where.status === loseRaceFor) {
            req.status = data.status; // the concurrent winner already advanced it
            loseRaceFor = null;
            return { count: 0 };
          }
          if (req.status === where.status) { req.status = data.status; return { count: 1 }; }
          return { count: 0 };
        },
        findMany: async () => [{ id: "r1" }],
      },
      vehicleRequestEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return {}; } },
    },
  },
});
mock.module("@/lib/services/inventory/request-inventory-match.service", {
  namedExports: { matchInventoryForRequest: async (id: string) => { matchCalls.push(id); if (matchBehavior === "throw") throw new Error("match boom"); return { outcome: "MATCHED" }; } },
});
mock.module("@/lib/services/acquisition/request-coverage-gate.service", {
  namedExports: { applyRequestCoverageGate: async (id: string) => { coverageCalls.push(id); if (coverageBehavior === "throw") throw new Error("coverage boom"); return { held: coverageBehavior === "held" }; } },
});

async function load() { return import("@/lib/services/vehicle-request/request-progression.service"); }

beforeEach(() => {
  req = { status: "SUBMITTED", makePreference: "Toyota", modelPreference: null, notes: null, buyer: { zip: "75201" } };
  events.length = 0; matchCalls.length = 0; coverageCalls.length = 0;
  matchBehavior = "ok"; coverageBehavior = "ok"; loseRaceFor = null;
});

test("incomplete submission (no zip) stays SUBMITTED", async () => {
  req.buyer = { zip: null };
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.advanced, false);
  assert.equal(r.to, "SUBMITTED");
  assert.equal(r.reason, "incomplete_submission");
  assert.equal(events.length, 0);
});

test("well-formed SUBMITTED advances all the way to ACTIVE_SOURCING with events + side effects", async () => {
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.from, "SUBMITTED");
  assert.equal(r.to, "ACTIVE_SOURCING");
  assert.equal(r.advanced, true);
  assert.deepEqual(events.map((e) => e.eventType), ["AUTO_INTAKE", "AUTO_SOURCING"]);
  assert.deepEqual(matchCalls, ["r1"], "inventory match runs at the sourcing step");
  assert.deepEqual(coverageCalls, ["r1"], "coverage gate runs at the sourcing step");
});

test("well-formed via notes/model (no make) also advances", async () => {
  req.makePreference = null; req.notes = "Looking for a reliable SUV under 30k";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.to, "ACTIVE_SOURCING");
});

test("thin coverage does NOT block advancement (advance + flag)", async () => {
  coverageBehavior = "held";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.to, "ACTIVE_SOURCING", "advances even when coverage is soft-held");
});

test("a failing matcher/coverage never blocks advancement (best-effort)", async () => {
  matchBehavior = "throw"; coverageBehavior = "throw";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.to, "ACTIVE_SOURCING");
});

test("starting at INTAKE advances straight to ACTIVE_SOURCING", async () => {
  req.status = "INTAKE";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.from, "INTAKE");
  assert.equal(r.to, "ACTIVE_SOURCING");
  assert.deepEqual(events.map((e) => e.eventType), ["AUTO_SOURCING"]);
});

test("idempotent: already ACTIVE_SOURCING is a no-op (not_advanceable)", async () => {
  req.status = "ACTIVE_SOURCING";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.advanced, false);
  assert.equal(r.reason, "not_advanceable");
  assert.equal(events.length, 0);
  assert.equal(matchCalls.length, 0);
});

test("terminal request (DEAL_CREATED) is never touched", async () => {
  req.status = "DEAL_CREATED";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.advanced, false);
  assert.equal(r.to, "DEAL_CREATED");
});

test("progression never advances past ACTIVE_SOURCING (no offer/deal auto-creation)", async () => {
  req.status = "OFFER_READY";
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  assert.equal(r.advanced, false, "OFFER_READY+ is admin/offer-driven, left untouched");
});

test("CAS lost race: a concurrent advance is picked up via re-read, no duplicate event", async () => {
  loseRaceFor = "SUBMITTED"; // this caller loses the SUBMITTED→INTAKE flip
  const { advanceVehicleRequest } = await load();
  const r = await advanceVehicleRequest("r1");
  // The winner did INTAKE; this caller re-reads and completes INTAKE→ACTIVE_SOURCING.
  assert.equal(r.to, "ACTIVE_SOURCING");
  assert.deepEqual(events.map((e) => e.eventType), ["AUTO_SOURCING"], "no duplicate AUTO_INTAKE from the loser");
});

test("reconcileRequestProgression advances scanned requests and counts outcomes", async () => {
  const { reconcileRequestProgression } = await load();
  const r = await reconcileRequestProgression();
  assert.equal(r.found, 1);
  assert.equal(r.advanced, 1);
});

test("reconcileRequestProgression counts an incomplete request without advancing it", async () => {
  req.buyer = { zip: null }; // incomplete → cannot advance
  const { reconcileRequestProgression } = await load();
  const r = await reconcileRequestProgression();
  assert.equal(r.found, 1);
  assert.equal(r.advanced, 0);
  assert.equal(r.incomplete, 1);
});
