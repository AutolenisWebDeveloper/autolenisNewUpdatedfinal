// GET /api/buyer/search must not DROP a car for being far away, unplaceable or stale.
//
// THE DEFECT THIS REPLACES. The route pushed a bounding box into the WHERE and then filtered
// again in memory with `d !== null && d <= radiusMiles`. Both halves dropped rows, and the
// second dropped every listing with a null coordinate — which, since the adapter had never
// written one, was the entire catalogue. A buyer who typed their ZIP saw nothing.
//
// §22a: distance is a label and a sort order, never a filter. What changes past the policy
// radius is the ACTION on the card — "Add to shortlist" becomes "Find one like this near me".
// The public catalogue was corrected this way in an earlier phase; this is the authenticated
// surface being brought into line (Phase 4).
//
//   npx tsx --test --experimental-test-module-mocks \
//     app/api/buyer/search/__tests__/no-radius-drop.test.ts

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

const BUYER_ID = "22222222-2222-4222-8222-222222222222";
const ARLINGTON = { lat: 32.7357, lng: -97.1081 };
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const DAY = 24 * 60 * 60 * 1000;

let rows: Array<Record<string, unknown>> = [];
let capturedWhere: Record<string, unknown> | null = null;
let geocodeCalls: string[] = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      preQualification: { findUnique: async () => ({ decision: "APPROVED", expiresAt: FUTURE, maxOtdAmountCents: 7_500_000 }) },
      inventoryItem: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          if (capturedWhere === null) { capturedWhere = where; return rows; }
          return []; // the local-dealer existence probe
        },
      },
    },
  },
});

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: {
    // 76011 is deliberately NOT in the 128-entry static ZIP table. The route must reach the
    // geocoder, or the market production actually sweeps cannot be placed at all.
    geocodeZip: async (zip: string) => {
      geocodeCalls.push(zip);
      return zip === "76011" ? { ...ARLINGTON, source: "google" } : null;
    },
  },
});

mock.module("@/lib/auth/api", {
  namedExports: {
    getRequestBuyer: async () => ({ id: BUYER_ID, zip: "76011" }),
    successResponse: (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { status: 200 }),
    errorResponse: (code: string, message: string, status: number) =>
      new Response(JSON.stringify({ ok: false, code, message }), { status }),
  },
});

interface Card { id: string; distanceMiles: number | null; action: string; actionReason: string; freshness: string }
interface Body { vehicles: Card[]; count: number; inRadiusCount: number; hasZip: boolean; radiusMiles: number; offerRequestPath: boolean }

async function search(query = ""): Promise<Body> {
  const { GET } = await import("@/app/api/buyer/search/route");
  const res = await GET(new NextRequest(`https://app.test/api/buyer/search${query}`));
  return ((await res.json()) as { data: Body }).data;
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "v1", year: 2022, make: "Toyota", model: "Camry", trim: null,
    mileage: 30_000, priceCents: 2_800_000, lane: "LANE_3", images: [],
    latitude: 32.75, longitude: -97.12,
    dealerId: null, sourceAdapter: "marketcheck", createdAt: new Date(),
    isActive: true, lastSeenAt: new Date(), addedByAdminId: null,
    ...over,
  };
}

beforeEach(() => { rows = []; capturedWhere = null; geocodeCalls = []; });

test("a car with NO coordinates is still returned, and offers the request path", async () => {
  rows = [row({ id: "unplaceable", latitude: null, longitude: null })];
  const body = await search();
  assert.equal(body.count, 1, "the row count out must equal the row count in");
  assert.equal(body.vehicles[0]!.distanceMiles, null);
  assert.equal(body.vehicles[0]!.action, "REQUEST_SIMILAR");
  assert.equal(body.vehicles[0]!.actionReason, "DISTANCE_UNKNOWN", "unprovable proximity is not proven proximity");
});

test("a car beyond the policy radius is still returned, with the request-path action", async () => {
  rows = [row({ id: "houston", latitude: 29.7604, longitude: -95.3698 })];
  const body = await search();
  assert.equal(body.count, 1);
  assert.ok((body.vehicles[0]!.distanceMiles ?? 0) > 200);
  assert.equal(body.vehicles[0]!.action, "REQUEST_SIMILAR");
  assert.equal(body.vehicles[0]!.actionReason, "OUT_OF_RADIUS");
  assert.equal(body.inRadiusCount, 0);
  assert.equal(body.offerRequestPath, true, "nothing reachable ⇒ lead with the custom request");
});

test("a nearby, fresh car is shortlistable", async () => {
  rows = [row({ id: "near" })];
  const body = await search();
  assert.equal(body.vehicles[0]!.action, "ADD");
  assert.equal(body.vehicles[0]!.freshness, "FRESH");
  assert.equal(body.inRadiusCount, 1);
  assert.equal(body.offerRequestPath, false);
});

test("freshness is on every card: 7 days notes it, 30 days blocks the shortlist", async () => {
  rows = [
    row({ id: "fresh", lastSeenAt: new Date(Date.now() - 1 * DAY) }),
    row({ id: "stale", lastSeenAt: new Date(Date.now() - 10 * DAY) }),
    row({ id: "expired", lastSeenAt: new Date(Date.now() - 40 * DAY) }),
  ];
  const byId = new Map((await search()).vehicles.map((v) => [v.id, v]));
  assert.equal(byId.get("fresh")!.freshness, "FRESH");
  assert.equal(byId.get("stale")!.freshness, "STALE");
  assert.equal(byId.get("stale")!.action, "ADD", "a 7-day note is a warning, not a block");
  assert.equal(byId.get("expired")!.freshness, "EXPIRED");
  assert.equal(byId.get("expired")!.action, "REQUEST_SIMILAR", "30 days blocks shortlisting");
});

test("no coordinate bounding box reaches the database", async () => {
  rows = [row()];
  await search();
  assert.equal(capturedWhere?.latitude, undefined, "a lat/lng box in the WHERE silently drops null-coordinate rows");
  assert.equal(capturedWhere?.longitude, undefined);
});

test("the client cannot move the policy radius", async () => {
  rows = [row({ id: "near" })];
  const body = await search("?radiusMiles=5");
  assert.equal(body.radiusMiles, 100, "the ceiling is AutoLenis policy, not a query parameter");
  assert.equal(body.vehicles[0]!.action, "ADD", "a car 2 miles away is not made ineligible by a query string");
});

test("the ZIP is placed through the geocoder, not the 128-entry static table", async () => {
  rows = [row()];
  const body = await search();
  assert.deepEqual(geocodeCalls, ["76011"]);
  assert.equal(body.hasZip, true, "the market production sweeps must be placeable");
});

test("cards are ordered nearest first", async () => {
  rows = [
    row({ id: "far", latitude: 32.99, longitude: -97.60 }),
    row({ id: "near", latitude: 32.74, longitude: -97.11 }),
  ];
  const body = await search();
  assert.deepEqual(body.vehicles.map((v) => v.id), ["near", "far"]);
});
