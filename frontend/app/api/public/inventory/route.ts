import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { InventoryLane, Prisma } from "@prisma/client";
import { lookupZip, haversineMiles, boundingBox } from "@/lib/utils/zip-coords";
import { listingFreshness } from "@/lib/services/inventory/inventory-eligibility";

export const dynamic = "force-dynamic";

const DEFAULT_PAGE_SIZE = 12;
const RECOGNIZED_BODY = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Convertible", "Wagon", "Hatchback"];

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(48, Math.max(1, parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10)));
  const make = searchParams.get("make")?.trim() ?? "";
  const model = searchParams.get("model")?.trim() ?? "";
  const lane = searchParams.get("lane") as InventoryLane | null;
  const minPriceCents = searchParams.get("priceMin") ? parseInt(searchParams.get("priceMin")!, 10) * 100 : null;
  const maxPriceCents = searchParams.get("priceMax") ? parseInt(searchParams.get("priceMax")!, 10) * 100 : null;
  const minYear = searchParams.get("yearMin") ? parseInt(searchParams.get("yearMin")!, 10) : null;
  const maxYear = searchParams.get("yearMax") ? parseInt(searchParams.get("yearMax")!, 10) : null;
  const maxMileage = searchParams.get("mileageMax") ? parseInt(searchParams.get("mileageMax")!, 10) : null;
  const condition = searchParams.get("condition") ?? "";
  const bodyType = searchParams.get("bodyType") ?? "";
  const transmission = searchParams.get("transmission") ?? "";
  const drivetrain = searchParams.get("drivetrain") ?? "";
  const fuelType = searchParams.get("fuelType") ?? "";
  const exteriorColor = searchParams.get("color") ?? "";
  const q = searchParams.get("q")?.trim() ?? "";
  const zip = searchParams.get("zip")?.trim().slice(0, 5) ?? "";
  const radiusMiles = searchParams.get("radiusMiles") ? parseFloat(searchParams.get("radiusMiles")!) : null;
  const sort = searchParams.get("sort") ?? "relevance";

  const where: Prisma.InventoryItemWhereInput = { isActive: true };
  if (make)         where.make = { equals: make, mode: "insensitive" };
  if (model)        where.model = { equals: model, mode: "insensitive" };
  if (lane)         where.lane = lane;
  if (condition)    where.condition = { equals: condition, mode: "insensitive" };
  if (bodyType && RECOGNIZED_BODY.includes(bodyType))
                    where.bodyType = { equals: bodyType, mode: "insensitive" };
  if (transmission) where.transmission = { equals: transmission, mode: "insensitive" };
  if (drivetrain)   where.drivetrain = { equals: drivetrain, mode: "insensitive" };
  if (fuelType)     where.fuelType = { equals: fuelType, mode: "insensitive" };
  if (exteriorColor) where.exteriorColor = { contains: exteriorColor, mode: "insensitive" };
  const featuresParam = searchParams.get("features") ?? "";
  if (featuresParam) {
    const feats = featuresParam.split(",").filter(Boolean);
    if (feats.length > 0) where.features = { hasEvery: feats };
  }

  if (minPriceCents !== null || maxPriceCents !== null) {
    where.priceCents = {};
    if (minPriceCents !== null) (where.priceCents as { gte?: number }).gte = minPriceCents;
    if (maxPriceCents !== null) (where.priceCents as { lte?: number }).lte = maxPriceCents;
  }
  if (minYear !== null || maxYear !== null) {
    where.year = {};
    if (minYear !== null) (where.year as { gte?: number }).gte = minYear;
    if (maxYear !== null) (where.year as { lte?: number }).lte = maxYear;
  }
  if (maxMileage !== null) where.mileage = { lte: maxMileage };

  if (q) {
    where.OR = [
      { make:  { contains: q, mode: "insensitive" } },
      { model: { contains: q, mode: "insensitive" } },
      { trim:  { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  // Geo filter
  let center: { lat: number; lng: number } | null = null;
  if (zip && radiusMiles && radiusMiles > 0) {
    center = lookupZip(zip);
    if (center) {
      const box = boundingBox(center, radiusMiles);
      where.latitude  = { gte: box.minLat, lte: box.maxLat };
      where.longitude = { gte: box.minLng, lte: box.maxLng };
    }
  }

  // ORDER BY
  let orderBy: Prisma.InventoryItemOrderByWithRelationInput | Prisma.InventoryItemOrderByWithRelationInput[];
  switch (sort) {
    case "price-asc":  orderBy = { priceCents: "asc" }; break;
    case "price-desc": orderBy = { priceCents: "desc" }; break;
    case "newest":     orderBy = { createdAt: "desc" }; break;
    case "mileage":    orderBy = [{ mileage: "asc" }, { createdAt: "desc" }]; break;
    default:           orderBy = { createdAt: "desc" };
  }

  // Fetch — when geo, fetch larger set then refine + sort by exact distance
  const fetchTake = center ? 200 : pageSize * 2; // x2 to dedupe
  const fetchSkip = center ? 0 : (page - 1) * pageSize;

  const [totalRaw, itemsRaw] = await Promise.all([
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.findMany({
      where,
      orderBy,
      skip: fetchSkip,
      take: fetchTake,
      select: {
        id: true, lane: true, vin: true, year: true, make: true, model: true, trim: true,
        mileage: true, priceCents: true, images: true, bodyType: true, condition: true,
        latitude: true, longitude: true,
        city: true, state: true,
        externalDealerCity: true, externalDealerState: true,
        dealerId: true, sourceAdapter: true,
        lastSeenAt: true, createdAt: true,
      },
    }),
  ]);

  // Dedupe by VIN (preserve order)
  const seen = new Set<string>();
  const deduped = itemsRaw.filter(it => {
    if (!it.vin) return true;
    if (seen.has(it.vin)) return false;
    seen.add(it.vin);
    return true;
  });

  // Compute distance + further filter when geo
  type WithDistance = typeof deduped[number] & { distanceMiles: number | null };
  let computed: WithDistance[] = deduped.map(it => {
    let d: number | null = null;
    if (center && it.latitude !== null && it.longitude !== null) {
      d = haversineMiles(center, { lat: Number(it.latitude), lng: Number(it.longitude) });
    }
    return { ...it, distanceMiles: d };
  });

  if (center && radiusMiles) {
    computed = computed.filter(it => it.distanceMiles !== null && it.distanceMiles <= radiusMiles);
    if (sort === "distance" || sort === "relevance") {
      computed.sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));
    }
  }

  // Apply dealer > admin > marketcheck priority when sorting by relevance
  if (!center && (sort === "relevance" || !sort)) {
    computed.sort((a, b) => {
      const pa = a.dealerId ? 0 : (!a.sourceAdapter ? 1 : 2);
      const pb = b.dealerId ? 0 : (!b.sourceAdapter ? 1 : 2);
      return pa - pb;
      // Within same tier, preserve DB createdAt order (already sorted by orderBy)
    });
  }

  // Page slice (final)
  const total = center ? computed.length : totalRaw;
  const start = center ? (page - 1) * pageSize : 0;
  const items = computed.slice(start, start + pageSize);

  // Serialize Decimal to number for JSON, and attach freshness.
  //
  // FRESHNESS IS A LABEL, NOT A FILTER. `where` above is unchanged — every active
  // listing stays visible, searchable, and paginated exactly as before. This field
  // only lets the UI say "last seen 12 days ago" or withhold a shortlist button.
  const freshnessNow = new Date();
  const serialized = items.map(it => {
    const f = listingFreshness(it, freshnessNow);
    return {
      ...it,
      latitude: it.latitude !== null ? Number(it.latitude) : null,
      longitude: it.longitude !== null ? Number(it.longitude) : null,
      distanceMiles: it.distanceMiles !== null ? Math.round(it.distanceMiles * 10) / 10 : null,
      freshness: {
        lastSeenAt: f.lastSeenAt,
        isStale: f.isStale,
        shortlistEligible: f.shortlistEligible,
      },
    };
  });

  return NextResponse.json({
    success: true,
    data: {
      items: serialized,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      geo: center ? { zip, radiusMiles, lat: center.lat, lng: center.lng } : null,
    },
  });
}
