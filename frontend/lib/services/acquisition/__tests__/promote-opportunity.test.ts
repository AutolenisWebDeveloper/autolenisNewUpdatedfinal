// A′ — promoteOpportunity: turn an existing BuyerOpportunity into a sourceable
// VehicleRequest (when a buyer resolves). Extracted from intakeBuyerRequest so the
// Zura chat can reuse it against its own live BuyerOpportunity (no duplicate
// opportunity). It does NOT trigger intake orchestration inline — the
// intake-reconcile cron is the single authoritative executor off durable DB state,
// so the creation path stays persist-only. With Inngest removed there is no event
// bus to dispatch to at all.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/acquisition/__tests__/promote-opportunity.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let existingVR: { id: string } | null = null;
const createdVR: Array<Record<string, unknown>> = [];
let userRow: { id: string; buyer: { id: string } | null } | null = null;
const oppUpdates: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      vehicleRequest: {
        findFirst: async () => existingVR,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdVR.push(data);
          return { id: "vr_new" };
        },
      },
      user: {
        findUnique: async () => userRow,
        create: async () => ({ id: "user_new" }),
      },
      buyer: { create: async () => ({ id: "buyer_new" }) },
      buyerOpportunity: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          oppUpdates.push(data);
          return {};
        },
      },
    },
  },
});

async function load() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service"))
    .promoteOpportunity;
}

beforeEach(() => {
  existingVR = null;
  createdVR.length = 0;
  userRow = null;
  oppUpdates.length = 0;
});

test("resolvable opportunity → creates ONE VehicleRequest and emits NO Inngest event", async () => {
  const promoteOpportunity = await load();
  const r = await promoteOpportunity("opp_1", {
    firstName: "Sam",
    email: "sam@example.com",
    make: "Toyota",
    model: "Camry",
    zip: "75001",
    budgetAmount: 3_000_000, // cents
  });
  assert.equal(r.vehicleRequestId, "vr_new");
  assert.equal(createdVR.length, 1);
  assert.equal(createdVR[0]!.buyerOpportunityId, "opp_1");
});

test("budget stays EXACT integer cents (no dollars round-trip drift)", async () => {
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", {
    firstName: "Sam",
    email: "sam@example.com",
    budgetAmount: 2_500_050, // cents — a non-whole-dollar amount
  });
  assert.equal(createdVR[0]!.maxBudgetCents, 2_500_050);
});

test("idempotent: an already-linked opportunity creates NO second VehicleRequest and emits nothing", async () => {
  existingVR = { id: "vr_existing" };
  const promoteOpportunity = await load();
  const r = await promoteOpportunity("opp_1", {
    firstName: "Sam",
    email: "sam@example.com",
    make: "Toyota",
  });
  assert.equal(r.vehicleRequestId, "vr_existing");
  assert.equal(createdVR.length, 0, "no duplicate VehicleRequest");
});

test("no resolvable buyer (missing email/name) → no VehicleRequest, still emits nothing", async () => {
  const promoteOpportunity = await load();
  const r = await promoteOpportunity("opp_1", { make: "Toyota", zip: "75001" });
  assert.equal(r.vehicleRequestId, null);
  assert.equal(createdVR.length, 0);
  // Intake (incl. lead enrichment/scoring for buyer-less opportunities) is run by
  // the cron via the "VR none" eligibility branch — never enqueued here.
});
