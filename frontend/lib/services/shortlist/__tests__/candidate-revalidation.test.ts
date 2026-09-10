// The candidate model: what revalidation DROPS and what it only REPORTS (§22a; Phase 4).
//
// A shortlist entry is what the buyer saved. A candidate is what dealers will be asked to bid
// on. Between the two sits time, and every fact the gate checked at add time can move: the car
// sells, is repriced, is relisted under a different VIN, moves rooftop, or is simply not seen
// again. This file pins which of those ends the candidacy and which is merely news.
//
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/shortlist/__tests__/candidate-revalidation.test.ts

import test, { beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

const NOW = new Date("2026-09-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ARLINGTON = { lat: 32.7357, lng: -97.1081 };

let candidates: Record<string, Record<string, unknown>> = {};
let listings: Record<string, Record<string, unknown>> = {};
let shortlistItems: Array<{ inventoryItemId: string; addedAt: Date }> = [];
const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
const creates: Array<Record<string, unknown>> = [];
let capAt = 5;

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: { geocodeZip: async () => ({ ...ARLINGTON, source: "static" }) },
});

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: { findUnique: async () => ({ id: "b1", zip: "76011", latitude: null, longitude: null }) },
      shortlist: { findUnique: async () => ({ items: shortlistItems }) },
      inventoryItem: { findUnique: async ({ where }: { where: { id: string } }) => listings[where.id] ?? null },
      auctionVehicle: {
        findUnique: async ({ where }: { where: { id: string } }) => candidates[where.id] ?? null,
        findMany: async ({ where }: { where: Record<string, unknown> }) =>
          Object.values(candidates).filter((c) =>
            where.vehicleRequestId ? c.vehicleRequestId === where.vehicleRequestId : true),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ id: where.id, data });
          Object.assign(candidates[where.id] ?? {}, data);
          return { id: where.id };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (creates.length >= capAt) {
            const e = new Error("auction_vehicles: five-candidate cap") as Error & { code?: string };
            e.code = "P0001";
            throw e;
          }
          creates.push(data);
          return { id: `av_${creates.length}` };
        },
      },
    },
  },
});

async function load() { return import("../candidate.service"); }

function listing(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "inv1", vin: "VIN1", year: 2022, make: "Toyota", model: "Camry", trim: "SE", mileage: 30_000,
    priceCents: 2_800_000, isActive: true, lastSeenAt: new Date(NOW.getTime() - DAY),
    lane: "LANE_3", dealerId: null, addedByAdminId: null,
    latitude: 32.75, longitude: -97.12, city: "Arlington", state: "TX",
    ...over,
  };
}

function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "av1", inventoryItemId: "inv1", candidateStatus: "ACTIVE", distanceMiles: 1.5,
    auction: { buyerId: "b1" }, vehicleRequest: { buyerId: "b1" },
    listingSnapshot: {
      vin: "VIN1", priceCents: 2_800_000, latitude: 32.75, longitude: -97.12,
      lastSeenAt: new Date(NOW.getTime() - DAY).toISOString(), distanceMiles: 1.5,
    },
    ...over,
  } as Record<string, unknown> & { listingSnapshot: Record<string, unknown> };
}

beforeEach(() => {
  candidates = { av1: candidate() };
  listings = { inv1: listing() };
  shortlistItems = [];
  updates.length = 0;
  creates.length = 0;
  capAt = 5;
});

// ── what stays ──────────────────────────────────────────────────────────────

test("nothing changed: still ACTIVE, and revalidatedAt is written anyway", async () => {
  const { revalidateCandidate } = await load();
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "ACTIVE");
  assert.deepEqual(v.changed, []);
  assert.equal(updates[0]!.data.revalidatedAt, NOW,
    "'checked and fine' and 'nobody has looked since Monday' are different states");
});

test("a price change is REPORTED, not fatal — even above the buyer's approved amount", async () => {
  // R58's over-ceiling flag was deliberately deferred (owner ruling 2026-09-10): an assumed tax
  // rate producing a number a buyer reads as real is a claim we cannot support. Dropping a car
  // for the same arithmetic would be the stronger version of what that ruling refused.
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ priceCents: 9_900_000 });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "ACTIVE");
  assert.deepEqual(v.changed, ["price"]);
  assert.equal(v.priceCents, 9_900_000);
  assert.equal((updates[0]!.data.listingSnapshot as { priceCents: number }).priceCents, 9_900_000,
    "the snapshot is refreshed so the buyer sees the new price, not the one they saved");
});

test("a move that stays inside the radius is reported as a location change", async () => {
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ latitude: 32.55, longitude: -97.45 });  // ~25 miles
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "ACTIVE");
  assert.deepEqual(v.changed, ["location"]);
  assert.ok((v.distanceMiles ?? 0) > 10);
});

// ── what drops ──────────────────────────────────────────────────────────────

test("the listing row is gone", async () => {
  const { revalidateCandidate } = await load();
  listings = {};
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "DROPPED");
  assert.equal(v.dropReason, "LISTING_GONE");
  assert.equal(updates[0]!.data.candidateStatus, "DROPPED");
});

test("the car sold", async () => {
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ isActive: false });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.dropReason, "UNAVAILABLE");
  assert.ok(v.changed.includes("availability"));
});

test("the VIN changed — that is a DIFFERENT CAR under the same row", async () => {
  // Checked before the gate on purpose: the gate would approve the replacement (active, near,
  // fresh) and the buyer would arrive at an auction for a vehicle they never chose.
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ vin: "VIN_OTHER" });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "DROPPED");
  assert.equal(v.dropReason, "VIN_CHANGED");
});

test("not seen in 30 days", async () => {
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ lastSeenAt: new Date(NOW.getTime() - 40 * DAY) });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.dropReason, "STALE_LISTING");
});

test("moved beyond the policy radius", async () => {
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ latitude: 29.7604, longitude: -95.3698 });  // Houston
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.dropReason, "OUT_OF_RADIUS");
});

test("can no longer be placed at all", async () => {
  const { revalidateCandidate } = await load();
  listings.inv1 = listing({ latitude: null, longitude: null });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.dropReason, "DISTANCE_UNKNOWN", "unprovable proximity is not proven proximity");
});

test("an admin-entered candidate with no listing behind it is left alone", async () => {
  const { revalidateCandidate } = await load();
  candidates.av1 = candidate({ inventoryItemId: null });
  const v = await revalidateCandidate("av1", NOW);
  assert.equal(v.status, "ACTIVE");
  assert.deepEqual(Object.keys(updates[0]!.data), ["revalidatedAt"], "nothing to revalidate against");
});

// ── promotion ───────────────────────────────────────────────────────────────

test("promotion writes distance and a snapshot, and re-gates rather than trusting add time", async () => {
  const { promoteShortlistToCandidates } = await load();
  candidates = {};
  listings = { inv1: listing(), inv2: listing({ id: "inv2", vin: "VIN2", isActive: false }) };
  shortlistItems = [
    { inventoryItemId: "inv1", addedAt: new Date(NOW.getTime() - 3 * DAY) },
    { inventoryItemId: "inv2", addedAt: new Date(NOW.getTime() - 2 * DAY) },
  ];
  const r = await promoteShortlistToCandidates("b1", { auctionId: "a1", vehicleRequestId: "vr1" }, NOW);

  assert.equal(r.created.length, 1);
  assert.deepEqual(r.skipped, [{ inventoryItemId: "inv2", reason: "UNAVAILABLE" }],
    "a car that sold between saving and promoting does not reach the auction");
  assert.equal(creates[0]!.vehicleRequestId, "vr1", "the candidate carries its request — the lineage parent");
  assert.ok(typeof creates[0]!.distanceMiles === "number");
  assert.ok((creates[0]!.listingSnapshot as { capturedAt?: string }).capturedAt);
});

test("promotion stops at five, and the DATABASE cap losing the race is a refusal not a crash", async () => {
  const { promoteShortlistToCandidates } = await load();
  candidates = {};
  listings = {};
  shortlistItems = [];
  for (let i = 1; i <= 7; i++) {
    listings[`inv${i}`] = listing({ id: `inv${i}`, vin: `VIN${i}` });
    shortlistItems.push({ inventoryItemId: `inv${i}`, addedAt: new Date(NOW.getTime() - i * DAY) });
  }
  capAt = 3;  // the trigger refuses earlier than the in-memory count would
  const r = await promoteShortlistToCandidates("b1", { auctionId: "a1", vehicleRequestId: "vr1" }, NOW);
  assert.equal(r.created.length, 3);
  assert.ok(r.skipped.every((s) => s.reason === "CAP_REACHED"));
  assert.equal(r.created.length + r.skipped.length, 7, "every shortlist entry is accounted for");
});

test("promotion is idempotent — an existing candidate is counted, not duplicated", async () => {
  const { promoteShortlistToCandidates } = await load();
  candidates = { av1: { id: "av1", inventoryItemId: "inv1", vehicleRequestId: "vr1", candidateStatus: "ACTIVE" } };
  listings = { inv1: listing() };
  shortlistItems = [{ inventoryItemId: "inv1", addedAt: NOW }];
  const r = await promoteShortlistToCandidates("b1", { auctionId: "a1", vehicleRequestId: "vr1" }, NOW);
  assert.deepEqual(r.created, []);
  assert.equal(r.existing, 1);
  assert.equal(creates.length, 0);
});
