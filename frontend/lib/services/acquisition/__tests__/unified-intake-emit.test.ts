// intakeBuyerRequest persists the records and does NOT trigger intake
// orchestration inline — buyer intake runs only on the intake-reconcile cron (the
// single authoritative executor) off durable DB state. This pins that the creation
// path stays lightweight (persist only, no heavy pipeline inline), and, as of
// Phase 2, that the lead and the request are written in ONE transaction.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/unified-intake-emit.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeFakePrisma, type FakeDb } from "./fake-prisma";

const db: FakeDb = makeFakePrisma();
mock.module("@/lib/prisma", { namedExports: { prisma: db.client } });
mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

async function load() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service")).intakeBuyerRequest;
}

beforeEach(() => db.reset());

test("a submission creates the opportunity + linked request without inline orchestration", async () => {
  const intakeBuyerRequest = await load();
  const result = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "sam@example.com",
    make: "Toyota",
    model: "Camry",
    zip: "75001",
    budgetAmount: 3_000_000, // cents
  });

  assert.ok(result.buyerOpportunityId);
  assert.ok(result.vehicleRequestId);
  assert.equal(db.state.vehicleRequests.size, 1, "one linked VehicleRequest");
  assert.equal(result.attachOutcome, "CREATED");
  assert.equal(result.requiresClaim, true, "a public capture is a guest until the address is claimed");

  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.buyerOpportunityId, result.buyerOpportunityId);
});

test("the lead and the request are written in ONE transaction", async () => {
  // The service used to make up to nine independent calls, so
  // "opportunity created, request failed" was a reachable state that was logged
  // and returned as a success with a null request id. If the request write throws,
  // the whole call must throw — the caller must not be told a lead was captured
  // when the transaction it belonged to did not complete.
  const intakeBuyerRequest = await load();
  const original = db.client.vehicleRequest as { create: (a: unknown) => Promise<unknown> };
  const saved = original.create;
  original.create = async () => {
    throw new Error("request write failed");
  };
  try {
    await assert.rejects(
      () => intakeBuyerRequest({ source: "request_vehicle_wizard", firstName: "Sam", email: "sam@example.com" }),
      /request write failed/,
      "a failed request write must surface, not be swallowed into a success with a null id"
    );
  } finally {
    original.create = saved;
  }
});

test("ZIP reaches the lead, the request AND the buyer — §5 rule 3", async () => {
  const intakeBuyerRequest = await load();
  const r = await intakeBuyerRequest({
    source: "request_vehicle_wizard",
    firstName: "Sam",
    email: "sam@example.com",
    zip: "75035",
    city: "Frisco",
    state: "TX",
  });

  const lead = db.state.opportunities.get(r.buyerOpportunityId)!;
  assert.equal(lead.zip, "75035");

  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.zip, "75035", "§7.1: the lead carried the ZIP and the request did not — that is the defect");
  assert.equal(vr.city, "Frisco");
  assert.equal(vr.state, "TX");

  const buyer = [...db.state.buyers.values()][0]!;
  assert.equal(buyer.zip, "75035", "the invitation matcher resolves coordinates from the BUYER");
  assert.equal(buyer.city, "Frisco");
});

test("a draft capture persists as DRAFT and the lead is not marked complete", async () => {
  const intakeBuyerRequest = await load();
  await intakeBuyerRequest({ source: "lp_campaign", firstName: "Sam", email: "sam@example.com", zip: "75035", draft: true });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.status, "DRAFT", "§5 rule 6: incomplete is a draft, never a dead end");
  const lead = [...db.state.opportunities.values()][0]!;
  assert.equal(lead.completed, false);
});
