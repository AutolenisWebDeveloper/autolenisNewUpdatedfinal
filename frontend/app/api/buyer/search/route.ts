import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { haversineMiles, boundingBox } from "@/lib/utils/zip-coords";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";
import { gateCatalogue, SHORTLIST_RADIUS_MILES } from "@/lib/services/shortlist/shortlist-radius";
import { APPROVED_AMOUNT_HEADROOM } from "@/lib/services/inventory/qualified-results.service";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";

export const dynamic = "force-dynamic";

// With a ZIP, distance ranking happens in memory, so the window has to cover the market rather
// than a page of it. 500 is the provider's own deep-paging ceiling and therefore the largest
// catalogue one market's sweep can produce.
const RANKING_WINDOW = 500;

function inventoryPriority(item: {
  dealerId?: string | null;
  sourceAdapter?: string | null;
}): number {
  if (item.dealerId) return 0;       // Dealer inventory
  if (!item.sourceAdapter) return 1; // Admin inventory
  return 2;                          // MarketCheck / external
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) {
    return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "24"), 48);
  const make = searchParams.get("make") ?? "";
  const model = searchParams.get("model") ?? "";
  const yearMin = searchParams.get("yearMin") ? parseInt(searchParams.get("yearMin")!) : null;
  const yearMax = searchParams.get("yearMax") ? parseInt(searchParams.get("yearMax")!) : null;
  const priceMinCents = searchParams.get("priceMin") ? Math.round(parseFloat(searchParams.get("priceMin")!) * 100) : null;
  const mileageMax = searchParams.get("mileageMax") ? parseInt(searchParams.get("mileageMax")!) : null;
  const condition = searchParams.get("condition") ?? "";
  const bodyType = searchParams.get("bodyType") ?? "";
  const transmission = searchParams.get("transmission") ?? "";
  const drivetrain = searchParams.get("drivetrain") ?? "";
  const fuelType = searchParams.get("fuelType") ?? "";
  const sort = searchParams.get("sort") ?? "newest";
  const features = searchParams.get("features") ?? "";

  // ZIP: use query param if provided, else fall back to buyer's profile zip
  const paramZip = searchParams.get("zip")?.trim().slice(0, 5) ?? "";
  const zip = paramZip || (buyer.zip ?? "");
  // RADIUS IS NOT A CLIENT PARAMETER AND NOT A FILTER (§22a; Phase 4).
  //
  // It used to be both: `radiusMiles` defaulted to 50, went into a bounding box in the WHERE,
  // and was then applied AGAIN as `filter(d !== null && d <= radiusMiles)`. Two consequences,
  // both silent. Every listing with a null coordinate was dropped — and the adapter had never
  // written a coordinate, so entering a ZIP emptied the catalogue. And a car 60 miles away
  // disappeared instead of offering the custom-request path.
  //
  // The 100-mile figure is AUTOLENIS POLICY (shortlist-radius.ts). It decides what ACTION a
  // card offers, never whether the card is rendered. `radiusMiles` on the query string is
  // therefore ignored; the row count out equals the row count in, and distance is a label and
  // a sort order. The public catalogue was corrected the same way — this brings the
  // authenticated surface into line with it.
  const radiusMiles = SHORTLIST_RADIUS_MILES;

  // Hard-enforce prequal budget ceiling server-side — never client-controlled.
  //
  // The ceiling comes from an APPROVED, unexpired prequal ONLY. Gating on the
  // mere existence of a row was a truthfulness bug: a PENDING / MANUAL_REVIEW /
  // DECLINED row carries maxOtdAmountCents = 0, which then propagated as an
  // approved budget of $0 — filtering every vehicle out of the buyer's search
  // and reporting "your $0 pre-qualified budget" for a decision that had not
  // been made. A buyer without a live approval simply has no ceiling yet; we
  // never invent one, and never default one.
  const prequal = await prisma.preQualification.findUnique({ where: { buyerId: buyer.id } });
  // The `> 0` guard is defence in depth, not dead code: a zero ceiling can only
  // ever mean "not determined" — it can never legitimately mean "this buyer may
  // spend nothing". Enforcing it would filter the entire catalogue to nothing,
  // which is precisely the failure this fix exists to remove, so an anomalous
  // APPROVED-with-zero row is treated as having no ceiling rather than a $0 one.
  const maxBudgetCents: number | null =
    isPrequalValid(prequal) && prequal !== null && prequal.maxOtdAmountCents > 0
      ? prequal.maxOtdAmountCents
      : null;
  // User-requested price max is capped at the approved ceiling (or stands alone
  // when there is no approved ceiling to cap it against).
  const paramPriceMax = searchParams.get("priceMax") ? Math.round(parseFloat(searchParams.get("priceMax")!) * 100) : null;
  // §13-D16, owner ruling 2026-09-10: the SEARCH ceiling is the approved amount plus 10%.
  // An approval is an out-the-door number; the sticker price a buyer negotiates from sits below
  // it by tax, title and fees, so filtering at the bare approved amount hides cars the buyer can
  // actually transact on. `maxBudgetCents` below still reports the APPROVAL, unchanged — the
  // headroom is how we search, not a larger number we tell the buyer they are approved for.
  //
  // R58's "this is $X over your approved amount" flag is deliberately NOT built: an assumed tax
  // rate producing a number a buyer reads as real is a claim we cannot support (same ruling).
  const priceCeilingCents = maxBudgetCents !== null
    ? Math.round(maxBudgetCents * APPROVED_AMOUNT_HEADROOM)
    : null;
  const priceCap = priceCeilingCents !== null
    ? (paramPriceMax !== null ? Math.min(paramPriceMax, priceCeilingCents) : priceCeilingCents)
    : paramPriceMax;

  const where: Prisma.InventoryItemWhereInput = { isActive: true };

  // Budget ceiling — always enforced when the buyer has a valid approval
  if (priceCap !== null) {
    where.priceCents = { ...(priceMinCents !== null ? { gte: priceMinCents } : {}), lte: priceCap };
  } else if (priceMinCents !== null) {
    where.priceCents = { gte: priceMinCents };
  }

  if (make)         where.make         = { equals: make,  mode: "insensitive" };
  if (model)        where.model        = { equals: model, mode: "insensitive" };
  if (yearMin || yearMax) {
    where.year = { ...(yearMin ? { gte: yearMin } : {}), ...(yearMax ? { lte: yearMax } : {}) };
  }
  if (mileageMax)   where.mileage      = { lte: mileageMax };
  if (condition)    where.condition    = { equals: condition, mode: "insensitive" };
  if (bodyType)     where.bodyType     = { equals: bodyType,  mode: "insensitive" };
  if (transmission) where.transmission = { equals: transmission, mode: "insensitive" };
  if (drivetrain)   where.drivetrain   = { equals: drivetrain,   mode: "insensitive" };
  if (fuelType)     where.fuelType     = { equals: fuelType,     mode: "insensitive" };

  if (q) {
    where.OR = [
      { make:  { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { trim:  { contains: q, mode: "insensitive" } },
    ];
  }

  // Features filter — each feature must appear in the features array
  const featureList = features ? features.split(",").map(f => f.trim()).filter(Boolean) : [];
  if (featureList.length > 0) {
    where.features = { hasSome: featureList };
  }

  // Placing the ZIP goes through the geocoder (static table -> cached Google -> Google,
  // fail-closed), not the 128-entry static table alone: that table does not contain 76011, the
  // market production is configured for, so a direct lookup returned no centre for the buyers
  // most likely to be searching. No bounding box goes into the WHERE — see the radius note.
  let center: { lat: number; lng: number } | null = null;
  if (zip) {
    const placed = await geocodeZip(zip);
    if (placed) center = { lat: placed.lat, lng: placed.lng };
  }

  // Sort ordering
  let orderBy: Prisma.InventoryItemOrderByWithRelationInput = { createdAt: "desc" };
  if (sort === "price-asc")  orderBy = { priceCents: "asc" };
  else if (sort === "price-desc") orderBy = { priceCents: "desc" };
  else if (sort === "mileage")    orderBy = { mileage: "asc" };

  const fetchTake = center ? RANKING_WINDOW : limit;
  const vehiclesRaw = await prisma.inventoryItem.findMany({
    where,
    take: fetchTake,
    orderBy,
    select: {
      id: true, year: true, make: true, model: true, trim: true,
      mileage: true, priceCents: true, lane: true, images: true,
      latitude: true, longitude: true,
      dealerId: true, sourceAdapter: true, createdAt: true,
      // Gate inputs. Availability and freshness decide the ACTION on a card, never whether the
      // card is rendered.
      isActive: true, lastSeenAt: true, addedByAdminId: true,
    },
  });

  // Distance, freshness and a per-card action. `gateCatalogue` has NO filter: the row count out
  // equals the row count in, and an out-of-radius, stale or unplaceable car offers the
  // custom-request path instead of vanishing.
  const { gated, inRadiusCount, hasZip } = gateCatalogue(vehiclesRaw, center);

  let vehicles = gated.map(g => ({
    ...g.row,
    distanceMiles: g.distanceMiles,
    freshness: g.gate.freshness,
    action: g.gate.action,
    actionReason: g.gate.reason,
  }));

  if (center) {
    // gateCatalogue has already ordered nearest-first; only a different explicit sort re-orders.
    if (sort === "newest") {
      vehicles.sort((a, b) => {
        const pa = inventoryPriority(a);
        const pb = inventoryPriority(b);
        if (pa !== pb) return pa - pb;
        return (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9);
      });
    } else if (sort !== "distance" && sort !== "relevance") {
      const rank = new Map(vehiclesRaw.map((it, i) => [it.id, i]));
      vehicles.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    }
  } else {
    if (sort === "newest") {
      // Tier-first (dealer → admin → market), then most recent within tier
      vehicles.sort((a, b) => {
        const pa = inventoryPriority(a);
        const pb = inventoryPriority(b);
        if (pa !== pb) return pa - pb;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
    } else if (sort === "relevance") {
      vehicles.sort((a, b) => inventoryPriority(a) - inventoryPriority(b));
    }
  }
  vehicles = vehicles.slice(0, limit);

  // Detect if any dealer inventory exists near the buyer's ZIP
  // Used to render the correct empty state in the UI
  let hasLocalDealerInventory: boolean | null = null;

  if (center && radiusMiles) {
    const box = boundingBox(center, radiusMiles);
    const candidates = await prisma.inventoryItem.findMany({
      where: {
        isActive: true,
        dealerId: { not: null },
        latitude:  { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLng, lte: box.maxLng },
      },
      select: { latitude: true, longitude: true },
      take: 20,
    });
    if (candidates.length > 0) {
      hasLocalDealerInventory = candidates.some(v =>
        v.latitude !== null && v.longitude !== null &&
        haversineMiles(center!, { lat: Number(v.latitude), lng: Number(v.longitude) }) <= radiusMiles
      );
    } else {
      hasLocalDealerInventory = false;
    }
  }

  const serialized = vehicles.map(v => ({
    ...v,
    latitude:  v.latitude  !== null ? Number(v.latitude)  : null,
    longitude: v.longitude !== null ? Number(v.longitude) : null,
  }));

  return successResponse({
    vehicles: serialized,
    count: serialized.length,
    budgetGuarded: maxBudgetCents !== null,
    /** The APPROVAL. Unchanged: the headroom below is how we search, not what we tell them. */
    maxBudgetCents,
    /** What the search actually filtered at — the approval plus the §13-D16 headroom. */
    priceCeilingCents,
    headroom: APPROVED_AMOUNT_HEADROOM,
    activeZip: zip || null,
    hasZip,
    /** How many the buyer could actually shortlist. Drives the empty state, never the grid. */
    inRadiusCount,
    /** LEAD with the custom-request path when nothing reachable came back. */
    offerRequestPath: hasZip && inRadiusCount === 0,
    hasLocalDealerInventory,
    /** AutoLenis policy, reported so a surface never has to guess it. Not a filter. */
    radiusMiles: SHORTLIST_RADIUS_MILES,
    radiusApplied: center ? radiusMiles : null,
  });
}
