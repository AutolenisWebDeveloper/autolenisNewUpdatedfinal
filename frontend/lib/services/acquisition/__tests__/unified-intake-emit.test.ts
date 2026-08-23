// intakeBuyerRequest persists the records and does NOT trigger intake
// orchestration inline — buyer intake is Inngest-free and the intake-reconcile
// cron is the single authoritative executor. This pins that the creation path
// emits NO Inngest event (and never runs the heavy pipeline inline).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/unified-intake-emit.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Guard: if the service ever re-introduces an Inngest emit, this spy records it
// and the test fails.
const sent: Array<{ name: string; data: Record<string, unknown> }> = [];

mock.module("@/lib/inngest/client", {
  namedExports: {
    inngest: {
      send: async (evt: { name: string; data: Record<string, unknown> }) => {
        sent.push(evt);
        return { ids: ["evt_1"] };
      },
    },
  },
});

const created: Array<Record<string, unknown>> = [];
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyerOpportunity: {
        create: async () => ({ id: "opp_1" }),
        update: async () => ({}),
      },
      user: {
        findUnique: async () => null,
        create: async () => ({ id: "user_1" }),
      },
      buyer: { create: async () => ({ id: "buyer_1" }) },
      vehicleRequest: {
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "vr_1" };
        },
      },
    },
  },
});

async function load() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service")).intakeBuyerRequest;
}

beforeEach(() => {
  sent.length = 0;
  created.length = 0;
});

test("a submission creates the opportunity + linked request and emits NO Inngest event", async () => {
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

  assert.equal(result.buyerOpportunityId, "opp_1");
  assert.equal(result.vehicleRequestId, "vr_1");
  assert.equal(created.length, 1, "one linked VehicleRequest");
  assert.equal(sent.length, 0, "intake is Inngest-free — no event emitted from the creation path");
});
