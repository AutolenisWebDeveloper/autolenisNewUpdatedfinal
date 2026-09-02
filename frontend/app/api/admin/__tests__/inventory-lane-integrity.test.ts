// LANE_1 integrity at the admin write paths.
//
// LANE_1 is a TWO-part claim — an active AutoLenis dealer AND an explicitly linked
// vehicle — and it drives a buyer-facing "Verified / directly from a verified AutoLenis
// dealer partner" badge. Production accumulated 95 rows carrying LANE_1 with
// dealer_id IS NULL (read-only, 2026-09-02). Those rows were both a false badge and
// permanently un-sweepable, because the stale sweep used `lane != LANE_1` as shorthand
// for "dealer-verified".
//
// Two live routes could still mint them. These tests pin both shut.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/admin/__tests__/inventory-lane-integrity.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let inventoryRows: Array<{ id: string; lane: string; vin: string | null; dealerId: string | null }> = [];
const updateManyCalls: Array<Record<string, unknown>> = [];
const createCalls: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      inventoryItem: {
        findMany: async () => inventoryRows,
        findFirst: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createCalls.push(data);
          return { id: "item_new", ...data };
        },
        updateMany: async (args: Record<string, unknown>) => {
          updateManyCalls.push(args);
          return { count: inventoryRows.length };
        },
      },
      adminAuditLog: { create: async () => ({ id: "log_1" }), createMany: async () => ({ count: 1 }) },
      $transaction: async (ops: unknown[]) => ops,
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminWithRole: async () => ({ adminId: "admin_1", email: "ops@autolenis.com" }),
    getAdminFromRequest: async () => ({ adminId: "admin_1", email: "ops@autolenis.com" }),
    getClientIp: () => "127.0.0.1",
    OPERATIONAL_ROLES: ["SUPER_ADMIN", "OPS"],
    adminSuccess: (data: unknown) => Response.json({ success: true, data }),
    adminError: (code: string, message: string, status: number) =>
      Response.json({ error: { code, message } }, { status }),
    createAuditLog: async () => ({ id: "log_1" }),
  },
});

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/admin/inventory/bulk-lane", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  inventoryRows = [];
  updateManyCalls.length = 0;
  createCalls.length = 0;
});

test("bulk-lane REFUSES LANE_1 for a vehicle with no dealer", async () => {
  inventoryRows = [
    { id: "veh_1", lane: "LANE_3", vin: "1FT", dealerId: null },
    { id: "veh_2", lane: "LANE_3", vin: "2FT", dealerId: "dealer_1" },
  ];
  const { PATCH } = await import("@/app/api/admin/inventory/bulk-lane/route");
  const res = await PATCH(patch({ ids: ["veh_1", "veh_2"], lane: "LANE_1" }));

  assert.equal(res.status, 400);
  const body = await res.json() as { error?: { message?: string } };
  assert.match(String(body.error?.message), /veh_1/, "the offending id is named");
  assert.equal(updateManyCalls.length, 0, "nothing is written when the claim is false");
});

test("bulk-lane ALLOWS LANE_1 when every selected vehicle has a dealer", async () => {
  inventoryRows = [{ id: "veh_2", lane: "LANE_3", vin: "2FT", dealerId: "dealer_1" }];
  const { PATCH } = await import("@/app/api/admin/inventory/bulk-lane/route");
  const res = await PATCH(patch({ ids: ["veh_2"], lane: "LANE_1" }));
  assert.equal(res.status, 200);
});

test("bulk-lane still allows LANE_2/LANE_3 for dealerless vehicles", async () => {
  inventoryRows = [{ id: "veh_1", lane: "LANE_1", vin: "1FT", dealerId: null }];
  const { PATCH } = await import("@/app/api/admin/inventory/bulk-lane/route");
  const res = await PATCH(patch({ ids: ["veh_1"], lane: "LANE_3" }));
  assert.equal(res.status, 200, "demoting a phantom LANE_1 row must stay possible");
});

test("search-tool/add writes LANE_3 with an admin id and a lastSeenAt, never LANE_1", async () => {
  const { POST } = await import("@/app/api/admin/inventory/search-tool/add/route");
  const res = await POST(new NextRequest("http://localhost/api/admin/inventory/search-tool/add", {
    method: "POST",
    body: JSON.stringify({
      vin: "1FTFW1E50NFA12345", make: "Ford", model: "F-150",
      year: 2022, price: 42000, mileage: 18000,
    }),
    headers: { "content-type": "application/json" },
  }));

  assert.equal(res.status, 201);
  assert.equal(createCalls.length, 1);
  const row = createCalls[0]!;
  assert.equal(row.lane, "LANE_3", "an admin-entered row has no dealer, so it is not LANE_1");
  assert.equal(row.addedByAdminId, "admin_1", "the curator is stamped so the sweep can exempt it");
  assert.ok(row.lastSeenAt instanceof Date, "a NULL lastSeenAt is invisible to every freshness query");
});
