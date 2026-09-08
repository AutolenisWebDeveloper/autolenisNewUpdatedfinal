// A′ — promoteOpportunity: turn an existing BuyerOpportunity into a sourceable
// VehicleRequest (when a buyer resolves). Extracted from intakeBuyerRequest so the
// Zura chat can reuse it against its own live BuyerOpportunity (no duplicate
// opportunity). It does NOT trigger intake orchestration inline — the
// intake-reconcile cron is the single authoritative executor off durable DB state,
<<<<<<< HEAD
// so the creation path stays persist-only.
//
// REWRITTEN FOR PHASE 2, not weakened. The service's contract genuinely changed:
// it now runs inside a transaction, resolves identity in rule-16 order, and
// attaches to the buyer's open request instead of creating a second one. Every
// assertion the previous version made is still made here — one request per
// opportunity, exact integer cents, idempotence, no request without a buyer — plus
// the new behaviour.
=======
// so the creation path stays persist-only. With Inngest removed there is no event
// bus to dispatch to at all.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/acquisition/__tests__/promote-opportunity.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
<<<<<<< HEAD
import { makeFakePrisma, type FakeDb } from "./fake-prisma";

const db: FakeDb = makeFakePrisma();

mock.module("@/lib/prisma", { namedExports: { prisma: db.client } });
mock.module("@/lib/logger", {
  namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
});

async function load() {
  return (await import("@/lib/services/acquisition/unified-buyer-intake.service")).promoteOpportunity;
}

beforeEach(() => db.reset());

test("resolvable opportunity → creates ONE VehicleRequest linked to it", async () => {
=======

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
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const promoteOpportunity = await load();
  const r = await promoteOpportunity("opp_1", {
    firstName: "Sam",
    email: "sam@example.com",
    make: "Toyota",
    model: "Camry",
    zip: "75001",
    budgetAmount: 3_000_000, // cents
  });
<<<<<<< HEAD
  assert.ok(r.vehicleRequestId);
  assert.equal(db.state.vehicleRequests.size, 1);
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.buyerOpportunityId, "opp_1");
});

test("budget stays EXACT integer cents — no dollars round-trip drift", async () => {
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", { firstName: "Sam", email: "sam@example.com", budgetAmount: 3_000_050 });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.maxBudgetCents, 3_000_050);
  assert.equal(vr.statedBudgetCents, 3_000_050);
});

test("idempotent: an already-linked opportunity creates NO second VehicleRequest", async () => {
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", { firstName: "Sam", email: "sam@example.com" });
  assert.equal(db.state.vehicleRequests.size, 1);
  const again = await promoteOpportunity("opp_1", { firstName: "Sam", email: "sam@example.com" });
  assert.equal(db.state.vehicleRequests.size, 1);
  assert.equal(again.vehicleRequestId, [...db.state.vehicleRequests.keys()][0]);
});

test("no resolvable buyer (missing email) → no VehicleRequest, and the lead still stands", async () => {
  const promoteOpportunity = await load();
  const r = await promoteOpportunity("opp_1", { firstName: "Sam" });
  assert.equal(r.vehicleRequestId, null);
  assert.equal(db.state.vehicleRequests.size, 0);
});

test("a second submission by the same buyer ATTACHES to the open request", async () => {
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", { firstName: "Sam", email: "sam@example.com", make: "Toyota" });
  assert.equal(db.state.vehicleRequests.size, 1);

  // A different opportunity, same person. §5 rule 5: attach and update, never a
  // second open request.
  const second = await promoteOpportunity("opp_2", { firstName: "Sam", email: "sam@example.com", model: "Camry" });
  assert.equal(db.state.vehicleRequests.size, 1, "a second open request must never be created");
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(second.vehicleRequestId, vr.id);
  assert.equal(vr.makePreference, "Toyota", "the first submission's value survives");
  assert.equal(vr.modelPreference, "Camry", "the second submission fills in what was missing");
});

test("a later submission never ERASES an earlier value", async () => {
=======
  assert.equal(r.vehicleRequestId, "vr_new");
  assert.equal(createdVR.length, 1);
  assert.equal(createdVR[0]!.buyerOpportunityId, "opp_1");
});

test("budget stays EXACT integer cents (no dollars round-trip drift)", async () => {
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", {
    firstName: "Sam",
    email: "sam@example.com",
<<<<<<< HEAD
    make: "Toyota",
    utmSource: "google",
    budgetAmount: 3_000_000,
  });
  await promoteOpportunity("opp_2", { firstName: "Sam", email: "sam@example.com", make: undefined });
  const vr = [...db.state.vehicleRequests.values()][0]!;
  assert.equal(vr.makePreference, "Toyota");
  assert.equal(vr.utmSource, "google", "overwriting the first touch's attribution would destroy the acquisition record §6.5 settles on");
  assert.equal(vr.maxBudgetCents, 3_000_000);
});

test("only ONE buyer is created for repeated submissions from one address", async () => {
  const promoteOpportunity = await load();
  await promoteOpportunity("opp_1", { firstName: "Sam", email: "sam@example.com" });
  await promoteOpportunity("opp_2", { firstName: "Sam", email: "sam@example.com" });
  await promoteOpportunity("opp_3", { firstName: "Sam", email: "sam@example.com" });
  assert.equal(db.state.buyers.size, 1);
  assert.equal(db.state.users.size, 1);
=======
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
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
});
