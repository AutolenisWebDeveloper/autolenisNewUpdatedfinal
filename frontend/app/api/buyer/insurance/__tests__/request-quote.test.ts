// Regression tests for POST /api/buyer/insurance/request-quote.
//
// Regression target: the route used to re-resolve the vehicle server-side as
// "the buyer's most recent shortlist item", racing against concurrent
// shortlist changes — the recorded vehicle could differ from the one the
// insurance page displayed. The submission is now bound to the EXPLICIT
// inventoryItemId the page rendered, validated against the buyer's shortlist.
//
// Run with:
//   npx tsx --test --experimental-test-module-mocks \
//     "app/api/buyer/insurance/__tests__/request-quote.test.ts"

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";

// ── Test fixtures ─────────────────────────────────────────────────────────────
const BUYER_ID = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const VEHICLE_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; // displayed on the page
const VEHICLE_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // shortlisted AFTER render

const VEHICLE_A = { year: 2023, make: "Toyota", model: "Camry", trim: "SE", vin: "VIN-A" };
const VEHICLE_B = { year: 2024, make: "Honda", model: "Accord", trim: null, vin: "VIN-B" };

// ── Controllable prisma behaviour ────────────────────────────────────────────
// Simulates the concurrent-shortlist sequence: by submit time the buyer's
// shortlist contains BOTH vehicles, with B the most recently added. Under the
// old "re-resolve most recent" logic the quote would record B; bound to the
// explicit ID it must record A.
let shortlistContents: string[] = [];
let auditLogEntries: Array<{ metadata: Record<string, unknown> }> = [];

const prismaMock = {
  deal: {
    findFirst: async ({ where }: { where: { id: string; buyerId: string } }) =>
      where.id === DEAL_ID && where.buyerId === BUYER_ID
        ? { id: DEAL_ID, insuranceStatus: "NOT_STARTED", offer: { otdPriceCents: 3_200_000 } }
        : null,
    update: async () => ({ id: DEAL_ID }),
  },
  shortlistItem: {
    findFirst: async ({ where }: { where: { inventoryItemId: string } }) =>
      shortlistContents.includes(where.inventoryItemId) ? { id: "sli_1" } : null,
  },
  inventoryItem: {
    findUnique: async ({ where }: { where: { id: string } }) =>
      where.id === VEHICLE_A_ID ? VEHICLE_A : where.id === VEHICLE_B_ID ? VEHICLE_B : null,
  },
  adminAuditLog: {
    create: async (args: { data: { metadata: Record<string, unknown> } }) => {
      auditLogEntries.push({ metadata: args.data.metadata });
      return { id: "audit_1" };
    },
  },
  notification: {
    create: async () => ({ id: "notif_1" }),
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaMock } });

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: BUYER_ID, firstName: "Test", lastName: "Buyer" }),
    successResponse: (data: unknown, status = 200) =>
      NextResponse.json({ success: true, data }, { status }),
    errorResponse: (code: string, message: string, status = 400) =>
      NextResponse.json({ error: { code, message } }, { status }),
  },
});

mock.module("@/lib/logger", {
  namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } },
});

async function postQuote(body: Record<string, unknown>) {
  const mod = await import("../request-quote/route");
  const req = new NextRequest("http://localhost/api/buyer/insurance/request-quote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return mod.POST(req);
}

beforeEach(() => {
  auditLogEntries = [];
  shortlistContents = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test("submitted vehicle == displayed vehicle even after a concurrent shortlist change", async () => {
  // Page rendered vehicle A; buyer then shortlisted B (now "most recent").
  shortlistContents = [VEHICLE_A_ID, VEHICLE_B_ID];

  const res = await postQuote({
    dealId: DEAL_ID,
    inventoryItemId: VEHICLE_A_ID, // the explicit rendered vehicle
    coverageType: "full",
  });

  assert.equal(res.status, 200);
  const json = (await res.json()) as { success: boolean; data: { vehicleSummary: string } };
  assert.equal(json.success, true);
  // The recorded vehicle must be A (displayed), never B (most recent).
  assert.match(json.data.vehicleSummary, /Toyota Camry/);
  assert.doesNotMatch(json.data.vehicleSummary, /Honda Accord/);

  assert.equal(auditLogEntries.length, 1);
  assert.equal(auditLogEntries[0].metadata.inventoryItemId, VEHICLE_A_ID);
  assert.match(String(auditLogEntries[0].metadata.vehicle), /Toyota Camry SE \(VIN: VIN-A\)/);
});

test("rejects a vehicle ID that is not on the buyer's shortlist", async () => {
  shortlistContents = [VEHICLE_B_ID]; // A is NOT shortlisted for this buyer

  const res = await postQuote({
    dealId: DEAL_ID,
    inventoryItemId: VEHICLE_A_ID,
    coverageType: "full",
  });

  assert.equal(res.status, 400);
  const json = (await res.json()) as { error: { code: string } };
  assert.equal(json.error.code, "VALIDATION_ERROR");
  assert.equal(auditLogEntries.length, 0);
});

test("no vehicle ID → records 'unavailable', never guesses from the shortlist", async () => {
  shortlistContents = [VEHICLE_A_ID, VEHICLE_B_ID]; // items exist, but none was displayed

  const res = await postQuote({ dealId: DEAL_ID, coverageType: "liability" });

  assert.equal(res.status, 200);
  const json = (await res.json()) as { success: boolean; data: { vehicleSummary: string } };
  assert.equal(json.data.vehicleSummary, "Vehicle details unavailable");
  assert.equal(auditLogEntries[0].metadata.inventoryItemId, null);
});
