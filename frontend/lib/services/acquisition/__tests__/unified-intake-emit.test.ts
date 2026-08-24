// intakeBuyerRequest persists the records and does NOT trigger intake
// orchestration inline — buyer intake runs only on the intake-reconcile cron
// (the single authoritative executor) off durable DB state. This pins that the
// creation path stays lightweight (persist only, no heavy pipeline inline). With
// Inngest fully removed there is no event bus to emit to at all — the
// no-external-dispatch invariant is enforced structurally + by the repo-wide
// "no @/lib/inngest import" guard.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks lib/services/acquisition/__tests__/unified-intake-emit.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

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
  created.length = 0;
});

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

  assert.equal(result.buyerOpportunityId, "opp_1");
  assert.equal(result.vehicleRequestId, "vr_1");
  assert.equal(created.length, 1, "one linked VehicleRequest");
});
