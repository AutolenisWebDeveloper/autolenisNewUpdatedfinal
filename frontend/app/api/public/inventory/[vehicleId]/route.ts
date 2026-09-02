import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listingFreshness } from "@/lib/services/inventory/inventory-eligibility";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ vehicleId: string }> }
) {
  const { vehicleId } = await params;

  const item = await prisma.inventoryItem.findUnique({
    where: { id: vehicleId, isActive: true },
    select: {
      id: true, lane: true, vin: true, year: true, make: true, model: true, trim: true,
      mileage: true, priceCents: true, description: true, images: true,
      condition: true, bodyType: true, exteriorColor: true, interiorColor: true,
      engine: true, transmission: true, drivetrain: true, fuelType: true,
      city: true, state: true, zip: true,
      latitude: true, longitude: true,
      externalListingUrl: true, externalDealerName: true,
      externalDealerCity: true, externalDealerState: true,
      createdAt: true, lastSeenAt: true,
    },
  });

  if (!item) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Vehicle not found" }, correlationId: crypto.randomUUID() },
      { status: 404 }
    );
  }

  // Compute market average for same make/model (active only) for price-context display
  const sameMakeModel = await prisma.inventoryItem.aggregate({
    where: { isActive: true, make: item.make, model: item.model },
    _avg: { priceCents: true },
    _count: true,
  });

  // Freshness is a LABEL. The lookup above still requires only isActive — the
  // detail page stays reachable for every active listing, however old.
  const f = listingFreshness(item);

  return NextResponse.json({
    success: true,
    data: {
      ...item,
      latitude: item.latitude !== null ? Number(item.latitude) : null,
      longitude: item.longitude !== null ? Number(item.longitude) : null,
      freshness: { lastSeenAt: f.lastSeenAt, isStale: f.isStale, shortlistEligible: f.shortlistEligible },
      marketContext: {
        avgPriceCents: sameMakeModel._avg.priceCents ?? null,
        sampleSize: sameMakeModel._count,
      },
    },
  });
}
