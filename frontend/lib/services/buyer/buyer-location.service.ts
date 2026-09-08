// lib/services/buyer/buyer-location.service.ts
//
// STAGE 2's HARD LOCATION GATE, as a predicate.
//
//   "Why this is a hard gate. A live auction received zero dealer invitations and
//    closed after roughly two hours of a forty-eight-hour window because the buyer
//    record carried null city, state, and ZIP. Location is not profile data. It is
//    transaction data, and the transaction cannot be sourced without it."
//
// §7.1 is that incident: deposit `b22c5013…` PAID, 9,900 cents, a buyer with
// `city`, `state` and `zip` all NULL and `onboarding_complete = true`, an auction
// that opened at 19:35 and closed at 21:35 with zero invitations — exactly
// `NO_DEALER_CLOSE_GRACE_MINUTES = 120` — and the deposit retained.
//
// THE DOWNSTREAM SAFEGUARD IS NOT THE BUG AND IS PRESERVED. The invitation matcher
// resolves coordinates from `geocodeZip(zip)` then `lookupCity(city, state)` and
// FAILS CLOSED to zero invitations when both are null
// (`dealer-invitation.service.ts:242-250`, comment at :17-20 "an unplaceable buyer
// invites zero"). That is the correct behaviour for a matcher and this phase does
// not touch it. The defect is UPSTREAM: no journey step wrote location, and no gate
// required it before payment or launch. So the buyer is discovered to be
// unplaceable AFTER the $99 is charged.
//
// WHAT THIS ADDS. One predicate that names the MISSING FIELD, which Stage 2
// requires ("the exact missing field", "returned to the specific field with a
// specific message, not a generic error") and which Phase 3's §5a eligibility
// recheck and Phase 5's launch readiness both consume. It is a pure read: it
// decides nothing and blocks nothing by itself — the phases that own those gates
// call it.
//
// GEOCODING ON WRITE. `buyers.latitude`, `longitude`, `geocoded_at` and
// `geocode_source` have existed since the Phase 1 wave with zero writers and zero
// readers; every consumer recomputed coordinates from the ZIP at read time, once
// per invitation run. `geocodeBuyerLocation` writes them once, at capture, so an
// address that cannot be placed is discovered while the buyer is still on the form.
//
// Run: pnpm test:buyer-location-backfill

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";

type Db = typeof prisma | Prisma.TransactionClient;

/** Which requirement is unmet. Named, so a surface can return the buyer to that field. */
export type LocationDefect = "ZIP_MISSING" | "STATE_MISSING" | "CITY_MISSING" | "NOT_GEOCODED" | "BUYER_NOT_FOUND";

export interface LocationEligibility {
  /** True only when every requirement is met. */
  usable: boolean;
  /** Every unmet requirement, in the order a form asks for them. */
  defects: LocationDefect[];
  /** The first field to return the buyer to. Null when usable. */
  focusField: "zip" | "city" | "state" | null;
  /** Buyer-facing, specific — never "something went wrong". */
  message: string | null;
  latitude: number | null;
  longitude: number | null;
}

const MESSAGES: Record<LocationDefect, string> = {
  ZIP_MISSING: "Add your ZIP code so we can find dealers near you.",
  STATE_MISSING: "Add your state so we can source in the right market.",
  CITY_MISSING: "Add your city so we can measure distance to each dealership.",
  NOT_GEOCODED: "We could not place that address on the map. Check the ZIP and city, and we will try again.",
  BUYER_NOT_FOUND: "We could not find your account.",
};

const FOCUS: Partial<Record<LocationDefect, "zip" | "city" | "state">> = {
  ZIP_MISSING: "zip",
  STATE_MISSING: "state",
  CITY_MISSING: "city",
  NOT_GEOCODED: "zip",
};

/**
 * Is this buyer's location usable for sourcing?
 *
 * "Usable" is the matcher's own standard, read forwards: a ZIP that geocodes, or a
 * city and state that do. Anything less is what produced an auction with zero
 * invitations. Stored coordinates satisfy it outright — that is what geocoding on
 * write is for.
 */
export async function evaluateLocationEligibility(buyerId: string, db: Db = prisma): Promise<LocationEligibility> {
  const buyer = await db.buyer.findUnique({
    where: { id: buyerId },
    select: { zip: true, city: true, state: true, latitude: true, longitude: true },
  });

  if (!buyer) {
    return { usable: false, defects: ["BUYER_NOT_FOUND"], focusField: null, message: MESSAGES.BUYER_NOT_FOUND, latitude: null, longitude: null };
  }

  // Stored coordinates are the strongest evidence and short-circuit the rest.
  if (buyer.latitude !== null && buyer.longitude !== null) {
    return { usable: true, defects: [], focusField: null, message: null, latitude: buyer.latitude, longitude: buyer.longitude };
  }

  const defects: LocationDefect[] = [];
  if (!buyer.zip) defects.push("ZIP_MISSING");
  if (!buyer.state) defects.push("STATE_MISSING");
  if (!buyer.city) defects.push("CITY_MISSING");

  // A ZIP alone is enough for the matcher, so a buyer with one is not blocked for
  // want of a city — but the ZIP must actually resolve.
  if (buyer.zip) {
    const point = await geocodeZip(buyer.zip).catch(() => null);
    if (point) {
      return {
        usable: true,
        defects: defects.filter((d) => d !== "STATE_MISSING" && d !== "CITY_MISSING"),
        focusField: null,
        message: null,
        latitude: point.lat,
        longitude: point.lng,
      };
    }
    // The ZIP is present and does not resolve. THAT is the actionable defect, and
    // it leads — a buyer staring at "add your state" when the real problem is a
    // ZIP that cannot be placed will add a state and still be blocked.
    defects.unshift("NOT_GEOCODED");
  }

  const first = defects[0]!;
  return {
    usable: false,
    defects,
    focusField: FOCUS[first] ?? null,
    message: MESSAGES[first],
    latitude: null,
    longitude: null,
  };
}

export interface GeocodeBuyerResult {
  geocoded: boolean;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
}

/**
 * Geocode a buyer's stored ZIP and persist the coordinates.
 *
 * Called at capture and at every address change, so an unplaceable address is
 * found while the buyer is still in front of the form rather than after payment.
 * Never overwrites coordinates that are already stored — a later, thinner
 * submission must not erase a placement that worked.
 */
export async function geocodeBuyerLocation(buyerId: string, db: Db = prisma): Promise<GeocodeBuyerResult> {
  const buyer = await db.buyer.findUnique({
    where: { id: buyerId },
    select: { zip: true, latitude: true, longitude: true },
  });
  if (!buyer) return { geocoded: false, latitude: null, longitude: null, source: null };
  if (buyer.latitude !== null && buyer.longitude !== null) {
    return { geocoded: true, latitude: buyer.latitude, longitude: buyer.longitude, source: "stored" };
  }
  if (!buyer.zip) return { geocoded: false, latitude: null, longitude: null, source: null };

  let point: Awaited<ReturnType<typeof geocodeZip>> = null;
  try {
    point = await geocodeZip(buyer.zip);
  } catch (err) {
    // A provider outage is not an unusable address. Leaving the columns NULL keeps
    // the predicate honest — it will retry — rather than recording a placement we
    // do not have.
    logger.error("[buyer-location] geocode failed", { buyerId, error: err instanceof Error ? err.message : String(err) });
    return { geocoded: false, latitude: null, longitude: null, source: null };
  }
  if (!point) return { geocoded: false, latitude: null, longitude: null, source: null };

  await db.buyer.update({
    where: { id: buyerId },
    data: { latitude: point.lat, longitude: point.lng, geocodedAt: new Date(), geocodeSource: point.source },
  });
  return { geocoded: true, latitude: point.lat, longitude: point.lng, source: point.source };
}
