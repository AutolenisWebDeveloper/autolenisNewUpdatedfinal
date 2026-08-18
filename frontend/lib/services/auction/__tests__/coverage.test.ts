// A3 — assessAuctionCoverage. Injected deps; runs under base `test`.
//   npx tsx --test --experimental-test-module-mocks \
//     lib/services/auction/__tests__/coverage.test.ts
//
// Distance trick: inject haversine = (a,b) => b.lat, buyer coords {lat:0,lng:0},
// and set each candidate's `latitude` to its distance-in-miles. So radius 50 ⇒
// latitude <= 50 is in-range. The fake prisma honors the capacity filter (dealers)
// and take + latitude bounding-box (prospects) so those behaviors are exercised.

import test from "node:test";
import assert from "node:assert/strict";
import {
  assessAuctionCoverage,
  MIN_COVERAGE_DEALERS,
  type CoverageDeps,
} from "../coverage.service";

type Dealer = { id: string; latitude: number | null; longitude: number | null; rooftopId: string | null; currentAuctionLoad?: number };
type Prospect = {
  id: string; name: string; website: string | null; city: string | null; state: string | null;
  email: string | null; emailVerificationStatus: string | null;
  latitude: number | null; longitude: number | null; rooftopId: string | null;
};

function fakePrisma(seed: { buyerZip?: string | null; dealers?: Dealer[]; prospects?: Prospect[] }) {
  return {
    auction: { findUnique: async () => ({ buyer: { zip: seed.buyerZip ?? "75201" } }) },
    dealer: {
      findMany: async ({ where }: { where: { currentAuctionLoad?: { lt: number } } }) => {
        const cap = where.currentAuctionLoad?.lt;
        return (seed.dealers ?? []).filter((d) =>
          cap == null ? true : (d.currentAuctionLoad ?? 0) < cap,
        );
      },
    },
    dealerProspect: {
      findMany: async ({ where, take }: { where: Record<string, { gte: number; lte: number } | unknown>; take?: number }) => {
        let rows = seed.prospects ?? [];
        // honor the latitude bounding-box the service adds when buyer is geocoded
        const latBox = where.latitude as { gte: number; lte: number } | undefined;
        if (latBox) rows = rows.filter((p) => p.latitude != null && p.latitude >= latBox.gte && p.latitude <= latBox.lte);
        return take ? rows.slice(0, take) : rows;
      },
    },
  };
}

const prospect = (over: Partial<Prospect> = {}): Prospect => ({
  id: "p1", name: "Toyota of Dallas", website: "toyotaofdallas.com", city: "Dallas", state: "TX",
  email: null, emailVerificationStatus: null, latitude: 10, longitude: 0, rooftopId: null, ...over,
});

// Distance trick: haversine == b.lat; buyer at {0,0}. boundingBox() uses lat/lng
// deltas around the center — with center lat 0 the latitude box is [-r/69, r/69],
// which is tiny, so for the bbox tests we bypass the real boundingBox by giving
// the fake a wide effective box: we set candidate longitudes to 0 and rely on the
// fake honoring latitude range only when present. To keep the trick simple, tests
// that exercise bbox set radius so the box includes the intended rows.
function deps(
  prisma: unknown,
  opts: { buyerCoords?: { lat: number; lng: number } | null; contactable?: (p: { id: string }) => boolean; channelConfigured?: boolean } = {},
): Partial<CoverageDeps> {
  const buyerCoords = opts.buyerCoords === undefined ? { lat: 0, lng: 0 } : opts.buyerCoords;
  return {
    prisma: prisma as never,
    geocode: async () => buyerCoords,
    haversine: (_a, b) => b.lat, // latitude == distance
    // Box consistent with the distance trick: [center.lat ± r]. So a prospect whose
    // latitude (== its distance) is within r of the center passes the box, and the
    // exact haversine (== b.lat) applies the radius.
    boundingBox: (c, r) => ({ minLat: c.lat - r, maxLat: c.lat + r, minLng: c.lng - r, maxLng: c.lng + r }),
    channelConfigured: () => opts.channelConfigured ?? true,
    resolveContact: (async (c: { id: string }) => ({
      contactable: opts.contactable ? opts.contactable(c) : true,
    })) as never,
  };
}

test("MIN_COVERAGE_DEALERS is the named threshold (default 3)", () => {
  assert.equal(MIN_COVERAGE_DEALERS, 3);
});

test("counts registered dealers + contactable prospects within radius", async () => {
  const prisma = fakePrisma({
    dealers: [
      { id: "d1", latitude: 10, longitude: 0, rooftopId: null },
      { id: "d2", latitude: 200, longitude: 0, rooftopId: null }, // out (>50)
    ],
    prospects: [prospect({ id: "p1", latitude: 20 }), prospect({ id: "p2", latitude: 40 })],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma));
  assert.equal(r.registered, 1);
  assert.equal(r.prospects, 2);
  assert.equal(r.coverage, 3);
  assert.equal(r.buyerGeocoded, true);
});

test("a prospect out of radius is not counted", async () => {
  const prisma = fakePrisma({ prospects: [prospect({ id: "p1", latitude: 500 })] });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma));
  assert.equal(r.prospects, 0);
});

// ─── M2: registered capacity filter ──────────────────────────────────────────

test("M2: a registered dealer at capacity (load >= 5) is not counted", async () => {
  const prisma = fakePrisma({
    dealers: [
      { id: "d_full", latitude: 10, longitude: 0, rooftopId: null, currentAuctionLoad: 5 },
      { id: "d_open", latitude: 10, longitude: 0, rooftopId: null, currentAuctionLoad: 2 },
    ],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma));
  assert.equal(r.registered, 1); // only d_open — d_full is at capacity, never invitable
});

// ─── M3: channel-config gate ─────────────────────────────────────────────────

test("M3: when the outreach channel is not configured, no prospect counts", async () => {
  const prisma = fakePrisma({
    dealers: [{ id: "d1", latitude: 10, longitude: 0, rooftopId: null }],
    prospects: [prospect({ id: "p1", latitude: 10 }), prospect({ id: "p2", latitude: 10 })],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma, { channelConfigured: false }));
  assert.equal(r.prospects, 0); // channel off → prospects can't be sent to
  assert.equal(r.registered, 1); // registered unaffected (internal invitation)
});

// ─── M1: bounding-box scopes the take ────────────────────────────────────────

test("M1: the take is applied AFTER geo-scoping — in-box prospects aren't crowded out", async () => {
  // 60 far prospects (lat 9999, outside any reasonable box) + 1 near (lat 5).
  // With a latitude bounding box the fake drops the far ones, so the near prospect
  // survives the take(60). (A pre-filter take ordered by stored distance could have
  // dropped it.) Here buyer lat is 5 so the box around it includes lat 5.
  const far = Array.from({ length: 60 }, (_, i) => prospect({ id: `far${i}`, latitude: 9999 }));
  const near = prospect({ id: "near", latitude: 5 });
  const prisma = fakePrisma({ prospects: [...far, near] });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma, { buyerCoords: { lat: 5, lng: 0 } }));
  // The far prospects fall outside the latitude box; only `near` remains and counts.
  assert.equal(r.prospects, 1);
});

// ─── INVARIANT: only send-safe prospects count ───────────────────────────────

test("INVARIANT: a non-contactable (unsafe) prospect is NOT counted", async () => {
  const prisma = fakePrisma({
    prospects: [prospect({ id: "p_ok", latitude: 10 }), prospect({ id: "p_bad", latitude: 10 })],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma, { contactable: (p) => p.id === "p_ok" }));
  assert.equal(r.prospects, 1);
});

// ─── rooftop dedup (prefer registered) ───────────────────────────────────────

test("a prospect sharing a registered dealer's rooftop is not double-counted", async () => {
  const prisma = fakePrisma({
    dealers: [{ id: "d1", latitude: 10, longitude: 0, rooftopId: "rf1" }],
    prospects: [prospect({ id: "p1", latitude: 10, rooftopId: "rf1" })],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma));
  assert.equal(r.registered, 1);
  assert.equal(r.prospects, 0);
  assert.equal(r.coverage, 1);
});

test("two prospects sharing a rooftop count once", async () => {
  const prisma = fakePrisma({
    prospects: [
      prospect({ id: "p1", latitude: 10, rooftopId: "rf9" }),
      prospect({ id: "p2", latitude: 10, rooftopId: "rf9" }),
    ],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma));
  assert.equal(r.prospects, 1);
});

// ─── resolveContact throwing is isolated ─────────────────────────────────────

test("a prospect whose resolution throws is skipped, not fatal", async () => {
  const prisma = fakePrisma({ prospects: [prospect({ id: "p1", latitude: 10 }), prospect({ id: "p2", latitude: 10 })] });
  const throwingDeps = {
    ...deps(prisma),
    resolveContact: (async (c: { id: string }) => {
      if (c.id === "p1") throw new Error("resolution boom");
      return { contactable: true };
    }) as never,
  };
  const r = await assessAuctionCoverage("a1", 50, throwingDeps);
  assert.equal(r.prospects, 1); // p2 still counted; p1 skipped
});

// ─── buyer not geocodable → fail open ────────────────────────────────────────

test("when the buyer can't be geocoded, all contactable candidates count (fail open)", async () => {
  const prisma = fakePrisma({
    dealers: [{ id: "d1", latitude: 999, longitude: 0, rooftopId: null }],
    prospects: [prospect({ id: "p1", latitude: 999 })],
  });
  const r = await assessAuctionCoverage("a1", 50, deps(prisma, { buyerCoords: null }));
  assert.equal(r.buyerGeocoded, false);
  assert.equal(r.coverage, 2);
});
