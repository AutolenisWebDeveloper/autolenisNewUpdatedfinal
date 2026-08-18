// S1 — intakeBuyerRequest must enqueue exactly one autolenis/intake.process
// event per submission (and never run the heavy pipeline inline anymore).
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/unified-intake-emit.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
      vehicleRequest: { create: async () => ({ id: "vr_1" }) },
    },
  },
});

async function load() {
  const mod = await import("@/lib/services/acquisition/unified-buyer-intake.service");
  return mod.intakeBuyerRequest;
}

beforeEach(() => {
  sent.length = 0;
});

test("a submission enqueues exactly one autolenis/intake.process event with the opportunity id", async () => {
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
  const intakeEvents = sent.filter((e) => e.name === "autolenis/intake.process");
  assert.equal(intakeEvents.length, 1, "exactly one intake.process event");
  assert.equal(intakeEvents[0]!.data.buyerOpportunityId, "opp_1");
});
