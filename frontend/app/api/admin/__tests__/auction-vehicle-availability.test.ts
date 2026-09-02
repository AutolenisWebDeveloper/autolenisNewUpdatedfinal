// An unavailable vehicle must never be carried into an auction.
//
// Dealers would be invited to bid on a car that has left the market, and the buyer would be
// shown offers on something they cannot buy. ShortlistItem.inventoryItemId has no foreign
// key and the stale sweep deactivates listings, so this is an ordinary state, not an exotic
// one: 10 of the 15 shortlist rows in production point at inventory the corrected sweep
// deactivates.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/admin/__tests__/auction-vehicle-availability.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

let inventory: Record<string, { isActive: boolean; priceCents: number }> = {};
const createdVehicles: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      auction: { findFirst: async () => ({ id: "auc_1" }) },
      auctionVehicle: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          createdVehicles.push(...data);
          return { count: data.length };
        },
      },
      inventoryItem: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.filter((id) => id in inventory).map((id) => ({ id, ...inventory[id]! })),
      },
      adminAuditLog: { create: async () => ({ id: "log_1" }) },
    },
  },
});

mock.module("@/lib/auth/admin-api", {
  namedExports: {
    getAdminFromRequest: async () => ({ adminId: "admin_1", email: "ops@autolenis.com", role: "SUPER_ADMIN" }),
    adminSuccess: (data: unknown) => Response.json({ success: true, data }),
    adminError: (code: string, message: string, status: number) =>
      Response.json({ error: { code, message } }, { status }),
  },
});

function post(vehicles: Array<Record<string, unknown>>) {
  return new NextRequest("http://localhost/api/admin/buyers/b1/auction-vehicles", {
    method: "POST",
    body: JSON.stringify({ auctionId: "auc_1", vehicles }),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ buyerId: "b1" });

const LIVE = { isActive: true, priceCents: 2_500_000 };
const SOLD = { isActive: false, priceCents: 2_500_000 };

beforeEach(() => {
  inventory = {};
  createdVehicles.length = 0;
});

test("a deactivated vehicle is REFUSED and nothing is attached", async () => {
  inventory = { v_live: LIVE, v_sold: SOLD };
  const { POST } = await import("@/app/api/admin/buyers/[buyerId]/auction-vehicles/route");
  const res = await POST(post([{ inventoryItemId: "v_live" }, { inventoryItemId: "v_sold" }]), { params });

  assert.equal(res.status, 400);
  const body = await res.json() as { error?: { message?: string } };
  assert.match(String(body.error?.message), /v_sold/, "the offending id is named");
  assert.equal(createdVehicles.length, 0, "the whole attach is refused, not partially applied");
});

test("a vehicle whose inventory row is GONE is refused too", async () => {
  inventory = { v_live: LIVE };
  const { POST } = await import("@/app/api/admin/buyers/[buyerId]/auction-vehicles/route");
  const res = await POST(post([{ inventoryItemId: "v_live" }, { inventoryItemId: "v_missing" }]), { params });
  assert.equal(res.status, 400);
  assert.equal(createdVehicles.length, 0);
});

test("all-live vehicles attach normally", async () => {
  inventory = { v1: LIVE, v2: LIVE };
  const { POST } = await import("@/app/api/admin/buyers/[buyerId]/auction-vehicles/route");
  const res = await POST(post([{ inventoryItemId: "v1" }, { inventoryItemId: "v2" }]), { params });
  assert.equal(res.status, 200);
  assert.equal(createdVehicles.length, 2);
});

test("free-form concierge entries are unaffected — they have no listing to go stale", async () => {
  const { POST } = await import("@/app/api/admin/buyers/[buyerId]/auction-vehicles/route");
  const res = await POST(post([{ year: 2022, make: "Ford", model: "F-150" }]), { params });
  assert.equal(res.status, 200);
  assert.equal(createdVehicles.length, 1);
  assert.equal(createdVehicles[0]!.inventoryItemId, null);
});
