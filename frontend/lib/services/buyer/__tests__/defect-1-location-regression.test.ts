// §7.1 REGRESSION — defect #1: a paid auction received zero dealer invitations and
// closed early.
//
// The shape, from production: deposit PAID at 9,900 cents; a buyer with `city`,
// `state` and `zip` all NULL and `onboarding_complete = true`; an auction whose
// 48-hour window opened at 19:35 and closed at 21:35 with zero invitations —
// exactly `NO_DEALER_CLOSE_GRACE_MINUTES = 120` — with the deposit retained.
//
// §8.2 assigns the location gate and the eligibility predicate to Phase 2, and the
// launch-readiness half to Phase 5. These are the Phase 2 half:
//
//   • a buyer with NULL location is NOT eligible, and the failure NAMES the field;
//   • a buyer with a resolvable location IS eligible, so the null-location
//     predicate downstream is never reached;
//   • the fail-closed matcher is preserved, not weakened — it is a STRONGER
//     safeguard and the defect was upstream of it.
//
// Tests construct their own data and never read the production rows §7.1 cites.
//
// Run: pnpm test:buyer-location-backfill

import test, { mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

const state = {
  buyers: new Map<string, Record<string, unknown>>(),
  geocodeResult: null as { lat: number; lng: number; source: string } | null,
  geocodeThrows: false,
  geocodeCalls: 0,
};

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      buyer: {
        findUnique: async ({ where }: { where: { id: string } }) => state.buyers.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = state.buyers.get(where.id)!;
          Object.assign(row, data);
          return { ...row };
        },
      },
    },
  },
});

mock.module("@/lib/services/integrations/geocoding.service", {
  namedExports: {
    geocodeZip: async () => {
      state.geocodeCalls++;
      if (state.geocodeThrows) throw new Error("provider down");
      return state.geocodeResult;
    },
  },
});

mock.module("@/lib/logger", { namedExports: { logger: { info: () => {}, warn: () => {}, error: () => {} } } });

function svc() {
  return import("@/lib/services/buyer/buyer-location.service");
}

beforeEach(() => {
  state.buyers.clear();
  state.geocodeResult = null;
  state.geocodeThrows = false;
  state.geocodeCalls = 0;
});

test("a buyer with NULL city, state and ZIP is NOT eligible, and the ZIP is named", async () => {
  const { evaluateLocationEligibility } = await svc();
  // §7.1's buyer, exactly: everything null, and onboarding marked complete — which
  // is what let the transaction advance to payment.
  state.buyers.set("b1", { zip: null, city: null, state: null, latitude: null, longitude: null });

  const result = await evaluateLocationEligibility("b1");
  assert.equal(result.usable, false);
  assert.deepEqual(result.defects, ["ZIP_MISSING", "STATE_MISSING", "CITY_MISSING"]);
  assert.equal(result.focusField, "zip", "Stage 2: returned to the SPECIFIC field");
  assert.match(String(result.message), /ZIP/, "…with a specific message, not a generic error");
  assert.equal(state.geocodeCalls, 0, "nothing to geocode");
});

test("a buyer with a resolvable ZIP IS eligible — the downstream null-location branch is never reached", async () => {
  const { evaluateLocationEligibility } = await svc();
  state.buyers.set("b1", { zip: "75035", city: null, state: null, latitude: null, longitude: null });
  state.geocodeResult = { lat: 33.15, lng: -96.82, source: "static" };

  const result = await evaluateLocationEligibility("b1");
  assert.equal(result.usable, true, "a ZIP the matcher can place is a usable location");
  assert.equal(result.latitude, 33.15);
  assert.equal(result.message, null);
});

test("a ZIP that does not resolve is NOT eligible, and says so specifically", async () => {
  const { evaluateLocationEligibility } = await svc();
  state.buyers.set("b1", { zip: "00000", city: null, state: null, latitude: null, longitude: null });
  state.geocodeResult = null;

  const result = await evaluateLocationEligibility("b1");
  assert.equal(result.usable, false);
  assert.ok(result.defects.includes("NOT_GEOCODED"));
  assert.match(String(result.message), /could not place/);
});

test("stored coordinates satisfy the gate without calling the provider", async () => {
  const { evaluateLocationEligibility } = await svc();
  state.buyers.set("b1", { zip: "75035", city: "Frisco", state: "TX", latitude: 33.15, longitude: -96.82 });

  const result = await evaluateLocationEligibility("b1");
  assert.equal(result.usable, true);
  assert.equal(state.geocodeCalls, 0, "geocoding on write is what makes the read cheap");
});

test("geocoding on write persists coordinates and their source", async () => {
  const { geocodeBuyerLocation } = await svc();
  state.buyers.set("b1", { zip: "75035", latitude: null, longitude: null });
  state.geocodeResult = { lat: 33.15, lng: -96.82, source: "static" };

  const out = await geocodeBuyerLocation("b1");
  assert.equal(out.geocoded, true);
  const row = state.buyers.get("b1")!;
  assert.equal(row.latitude, 33.15);
  assert.equal(row.longitude, -96.82);
  assert.equal(row.geocodeSource, "static");
  assert.ok(row.geocodedAt instanceof Date);
});

test("a provider outage leaves the columns NULL rather than recording a placement we do not have", async () => {
  const { geocodeBuyerLocation, evaluateLocationEligibility } = await svc();
  state.buyers.set("b1", { zip: "75035", latitude: null, longitude: null });
  state.geocodeThrows = true;

  const out = await geocodeBuyerLocation("b1");
  assert.equal(out.geocoded, false);
  const row = state.buyers.get("b1")!;
  assert.equal(row.latitude, null, "a provider outage is not an unusable address, and not a placement either");

  // And the predicate stays honest about it — it will retry rather than pass.
  state.geocodeThrows = true;
  const elig = await evaluateLocationEligibility("b1");
  assert.equal(elig.usable, false);
  assert.ok(elig.defects.includes("NOT_GEOCODED"));
});

test("geocoding never overwrites coordinates that are already stored", async () => {
  const { geocodeBuyerLocation } = await svc();
  state.buyers.set("b1", { zip: "75035", latitude: 1.5, longitude: 2.5 });
  state.geocodeResult = { lat: 99, lng: 99, source: "google" };

  const out = await geocodeBuyerLocation("b1");
  assert.equal(out.latitude, 1.5, "a later, thinner submission must not erase a placement that worked");
  assert.equal(state.geocodeCalls, 0);
});

test("the fail-closed invitation matcher is PRESERVED, not weakened", async () => {
  // §7.1 is explicit that the matcher is "a STRONGER safeguard to preserve" and
  // that the defect is upstream of it. This asserts the safeguard is still in the
  // source, because a plausible-looking "fix" for defect #1 is to make the matcher
  // fall back to a default market — which would turn a visible zero-invitation
  // auction into an invisible wrong-market one.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(`${process.cwd()}/lib/services/auction/dealer-invitation.service.ts`, "utf8");
  assert.match(src, /an unplaceable buyer invites zero/i, "the fail-closed comment and behaviour must remain");
  assert.ok(
    !/DEFAULT_ZIP|FALLBACK_ZIP|fallbackMarket/.test(src),
    "no default-market fallback may be introduced — that would hide the defect rather than fix it"
  );
});
