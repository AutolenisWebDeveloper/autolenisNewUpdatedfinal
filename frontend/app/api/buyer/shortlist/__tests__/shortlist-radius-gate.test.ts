// The radius and freshness gates are enforced SERVER-SIDE.
//
// The UI decides which button to render; the server decides what is allowed. A gate that lives
// only in the card is one fetch away from being bypassed, and the result is a car 400 miles away
// sitting in an auction whose invited dealers cannot service it.
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/shortlist/__tests__/shortlist-radius-gate.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Arlington TX 76011 and Dallas TX 75201 are ~20 miles apart; 10001 is Manhattan.
let buyerZip: string | null = "75201";
let vehicle: Record<string, unknown> | null = null;
const created: Array<Record<string, unknown>> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: { findUnique: async () => ({ id: "b1", zip: buyerZip }) },
      inventoryItem: {
        findUnique: async () => vehicle,
        findMany: async () => [],
      },
      shortlist: {
        upsert: async () => ({ id: "sl_1", buyerId: "b1", items: [] }),
        findUnique: async () => ({ id: "sl_1", buyerId: "b1", items: [] }),
      },
      shortlistItem: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: "item_1", ...data };
        },
      },
    },
  },
});

// Geocoding is stubbed to the static tier only. The real service also consults a Redis cache
// and Google, neither of which belongs in a unit test — and the ZIPs below are all static hits
// or deliberate misses, which is exactly the behaviour being asserted.
mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: {
    geocodeZip: async (zip: string) => {
      const table: Record<string, { lat: number; lng: number }> = {
        "75201": { lat: 32.7831, lng: -96.8067 },  // Dallas
        "10001": { lat: 40.7506, lng: -73.9971 },  // Manhattan
      };
      const hit = table[zip];
      return hit ? { ...hit, source: "static" as const } : null;
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: "b1" }),
    successResponse: (data: unknown) => Response.json({ success: true, data }),
    errorResponse: (code: string, message: string, status: number) =>
      Response.json({ error: { code, message } }, { status }),
  },
});

function post(inventoryItemId = "v1") {
  return new NextRequest("http://localhost/api/buyer/shortlist", {
    method: "POST",
    body: JSON.stringify({ inventoryItemId }),
    headers: { "content-type": "application/json" },
  });
}

/** A live, near, freshly-seen Arlington listing. */
function listing(over: Record<string, unknown> = {}) {
  return {
    id: "v1", isActive: true, priceCents: 2_500_000,
    lastSeenAt: new Date(), lane: "LANE_3", dealerId: null, addedByAdminId: null,
    latitude: 32.7451, longitude: -97.0836,
    year: 2022, make: "Ford", model: "F-150", trim: "XLT", mileage: 41_200,
    ...over,
  };
}

async function POST(req: NextRequest) {
  const mod = await import("@/app/api/buyer/shortlist/route");
  return mod.POST(req);
}

beforeEach(() => {
  buyerZip = "75201";
  vehicle = listing();
  created.length = 0;
});

test("a near, fresh, live listing is accepted", async () => {
  const res = await POST(post());
  assert.equal(res.status, 200);
  assert.equal(created.length, 1);
});

test("a listing beyond 100 miles is REFUSED even though the UI would have hidden the button", async () => {
  // Manhattan dealer, Dallas buyer.
  vehicle = listing({ latitude: 40.7506, longitude: -73.9972 });
  const res = await POST(post());
  assert.equal(res.status, 400);
  const body = await res.json() as { error?: { code?: string } };
  assert.equal(body.error?.code, "OUT_OF_RADIUS");
  assert.equal(created.length, 0);
});

test("a listing with no coordinates is refused — unprovable proximity is not proximity", async () => {
  vehicle = listing({ latitude: null, longitude: null });
  const res = await POST(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error?: { code?: string } }).error?.code, "DISTANCE_UNKNOWN");
});

test("a buyer with no ZIP is asked for one rather than silently allowed", async () => {
  buyerZip = null;
  const res = await POST(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error?: { code?: string } }).error?.code, "NO_ZIP");
  assert.equal(created.length, 0);
});

test("a buyer ZIP that cannot be placed fails CLOSED", async () => {
  buyerZip = "00000";
  const res = await POST(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error?: { code?: string } }).error?.code, "NO_ZIP");
});

test("a listing not seen in 30 days is refused", async () => {
  vehicle = listing({ lastSeenAt: new Date(Date.now() - 31 * 864e5) });
  const res = await POST(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error?: { code?: string } }).error?.code, "STALE_LISTING");
});

test("a listing not seen in 8 days is STILL accepted — the 7-day mark only flags", async () => {
  vehicle = listing({ lastSeenAt: new Date(Date.now() - 8 * 864e5) });
  const res = await POST(post());
  assert.equal(res.status, 200);
  assert.equal(created.length, 1);
});

test("a deactivated listing is refused", async () => {
  vehicle = listing({ isActive: false });
  assert.equal((await POST(post())).status, 400);
  assert.equal(created.length, 0);
});

test("dealer-managed inventory is exempt from freshness but NOT from radius", async () => {
  vehicle = listing({
    lane: "LANE_1", dealerId: "d1", lastSeenAt: new Date(Date.now() - 400 * 864e5),
    latitude: 40.7506, longitude: -73.9972,
  });
  const res = await POST(post());
  assert.equal(res.status, 400);
  assert.equal((await res.json() as { error?: { code?: string } }).error?.code, "OUT_OF_RADIUS",
    "the freshness exemption must not become a radius exemption");
});

test("a missing vehicle is still a 404, not a gate failure", async () => {
  vehicle = null;
  assert.equal((await POST(post("nope"))).status, 404);
});

test("the refusal names the custom-request route so the UI never dead-ends", async () => {
  vehicle = listing({ latitude: 40.7506, longitude: -73.9972 });
  const body = await (await POST(post())).json() as { error?: { message?: string } };
  assert.match(String(body.error?.message), /request/i);
});
