import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { lookupZip, haversineMiles, boundingBox } from "@/lib/utils/zip-coords";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";

export const dynamic = "force-dynamic";

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
  const paramRadius = searchParams.get("radiusMiles") ? parseFloat(searchParams.get("radiusMiles")!) : null;
  // Default to 50 miles when a zip is present
  const radiusMiles = paramRadius ?? (zip ? 50 : null);

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
  const priceCap = maxBudgetCents !== null
    ? (paramPriceMax !== null ? Math.min(paramPriceMax, maxBudgetCents) : maxBudgetCents)
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

  let center: { lat: number; lng: number } | null = null;
  if (zip && radiusMiles && radiusMiles > 0) {
    center = lookupZip(zip);
    if (center) {
      const box = boundingBox(center, radiusMiles);
      where.latitude  = { gte: box.minLat, lte: box.maxLat };
      where.longitude = { gte: box.minLng, lte: box.maxLng };
    }
  }

  // Sort ordering
  let orderBy: Prisma.InventoryItemOrderByWithRelationInput = { createdAt: "desc" };
  if (sort === "price-asc")  orderBy = { priceCents: "asc" };
  else if (sort === "price-desc") orderBy = { priceCents: "desc" };
  else if (sort === "mileage")    orderBy = { mileage: "asc" };

  const fetchTake = center ? Math.max(limit * 4, 200) : limit;
  const vehiclesRaw = await prisma.inventoryItem.findMany({
    where,
    take: fetchTake,
    orderBy,
    select: {
      id: true, year: true, make: true, model: true, trim: true,
      mileage: true, priceCents: true, lane: true, images: true,
      latitude: true, longitude: true,
      dealerId: true, sourceAdapter: true, createdAt: true,
    },
  });

  let vehicles = vehiclesRaw.map(v => {
    let d: number | null = null;
    if (center && v.latitude !== null && v.longitude !== null) {
      d = haversineMiles(center, { lat: Number(v.latitude), lng: Number(v.longitude) });
    }
    return { ...v, distanceMiles: d !== null ? Math.round(d * 10) / 10 : null };
  });

  if (center && radiusMiles) {
    vehicles = vehicles.filter(v => v.distanceMiles !== null && v.distanceMiles <= radiusMiles);
    if (sort === "distance") {
      vehicles.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));
    } else if (sort === "newest") {
      // Tier-first (dealer → admin → market), then closest within tier
      vehicles.sort((a, b) => {
        const pa = inventoryPriority(a);
        const pb = inventoryPriority(b);
        if (pa !== pb) return pa - pb;
        return (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9);
      });
    }
    vehicles = vehicles.slice(0, limit);
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
    vehicles = vehicles.slice(0, limit);
  }

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
    maxBudgetCents,
    activeZip: zip || null,
    hasLocalDealerInventory,
    radiusApplied: center ? radiusMiles : null,
  });
}
