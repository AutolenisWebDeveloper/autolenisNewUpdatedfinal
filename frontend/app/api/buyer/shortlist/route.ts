import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";
import { countAvailableItems } from "@/lib/services/shortlist/shortlist.service";
import { shortlistGate, distanceMilesBetween, SHORTLIST_RADIUS_MILES } from "@/lib/services/shortlist/shortlist-radius";
import { geocodeZip } from "@/lib/services/integrations/geocoding.service";

/**
 * Why the shortlist action is unavailable, in the buyer's words.
 *
 * Every message names the way forward. A refusal that only says "no" turns a browsable
 * catalogue into a dead end, which is the failure this whole feature exists to remove.
 */
const SHORTLIST_REFUSALS: Record<string, string> = {
  NO_ZIP: "Add your ZIP code so we can check which vehicles are close enough to bring to auction.",
  OUT_OF_RADIUS:
    `This vehicle is more than ${SHORTLIST_RADIUS_MILES} miles away, so we cannot bring it to ` +
    `auction. Start a vehicle request and we will find one like it near you.`,
  DISTANCE_UNKNOWN:
    "We cannot confirm where this vehicle is located. Start a vehicle request and we will find one like it near you.",
  STALE_LISTING:
    "This listing has not been seen on the market for over 30 days. Start a vehicle request and we will find one like it near you.",
  UNAVAILABLE:
    "This vehicle is no longer available. Start a vehicle request and we will find one like it near you.",
  OK: "",
};

// POST /api/buyer/shortlist — add item
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { inventoryItemId } = await request.json() as { inventoryItemId: string };
  if (!inventoryItemId) return errorResponse("VALIDATION_ERROR", "inventoryItemId is required", 400);

  // Verify vehicle exists. Narrowed to the gate's inputs: an unnarrowed read returns every
  // declared column and raises P2022 while the dealer-provenance migration is unapplied.
  const vehicle = await prisma.inventoryItem.findUnique({
    where: { id: inventoryItemId },
    select: {
      id: true, isActive: true, priceCents: true, lastSeenAt: true,
      lane: true, dealerId: true, addedByAdminId: true, latitude: true, longitude: true,
    },
  });
  if (!vehicle) return errorResponse("NOT_FOUND", "Vehicle not found", 404);

  // Radius + freshness, enforced HERE and not only in the card. The UI decides which button to
  // render; the server decides what is allowed. Without this a single fetch puts a car 400 miles
  // away into an auction whose invited dealers cannot service it.
  //
  // Fail CLOSED on an unplaceable buyer, which is the opposite of assessCoverageForZip — and
  // deliberately so. Coverage fails open because wrongly soft-holding a deposit is the dangerous
  // direction there; here the buyer loses nothing by being routed to a custom Vehicle Request,
  // and every refusal below offers exactly that route rather than a dead end.
  const buyerRow = await prisma.buyer.findUnique({
    where: { id: buyer.id },
    select: { zip: true },
  });
  const buyerCoords = buyerRow?.zip ? await geocodeZip(buyerRow.zip) : null;

  const gate = shortlistGate(
    {
      distanceMiles: distanceMilesBetween(buyerCoords, vehicle.latitude, vehicle.longitude),
      isActive: vehicle.isActive,
      priceCents: vehicle.priceCents,
      lastSeenAt: vehicle.lastSeenAt,
      lane: vehicle.lane,
      dealerId: vehicle.dealerId,
      addedByAdminId: vehicle.addedByAdminId,
    },
    { hasZip: !!buyerCoords },
  );

  if (gate.action !== "ADD") {
    // The gate's own reason IS the error code: one vocabulary shared by the card and the API, so
    // the two can never disagree about why an action is unavailable.
    return errorResponse(gate.reason, SHORTLIST_REFUSALS[gate.reason], 400);
  }

  // Get or create shortlist
  const shortlist = await prisma.shortlist.upsert({
    where: { buyerId: buyer.id },
    create: { buyerId: buyer.id },
    update: {},
    include: { items: true },
  });

  // MAX_SHORTLIST_ITEMS enforcement, counting AVAILABLE candidates only. Counting rows
  // would lock a buyer whose saved cars have sold out of adding their replacements.
  if (await countAvailableItems(shortlist.items) >= MAX_SHORTLIST_ITEMS) {
    return errorResponse("SHORTLIST_FULL", `Shortlist is limited to ${MAX_SHORTLIST_ITEMS} vehicles`, 400);
  }

  // Check duplicate
  const exists = shortlist.items.some(i => i.inventoryItemId === inventoryItemId);
  if (exists) return errorResponse("ALREADY_IN_SHORTLIST", "Vehicle already in shortlist", 400);

  const item = await prisma.shortlistItem.create({
    data: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY" },
  });

  return successResponse({ item });
}

// GET /api/buyer/shortlist
export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const shortlist = await prisma.shortlist.findUnique({
    where: { buyerId: buyer.id },
    include: { items: true },
  });

  return successResponse({ items: shortlist?.items ?? [], count: shortlist?.items.length ?? 0 });
}

// DELETE /api/buyer/shortlist?inventoryItemId=...  — remove item
export async function DELETE(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const inventoryItemId = searchParams.get("inventoryItemId");
  if (!inventoryItemId) return errorResponse("VALIDATION_ERROR", "inventoryItemId is required", 400);

  const shortlist = await prisma.shortlist.findUnique({ where: { buyerId: buyer.id } });
  if (!shortlist) return errorResponse("NOT_FOUND", "No shortlist", 404);

  const removed = await prisma.shortlistItem.deleteMany({
    where: { shortlistId: shortlist.id, inventoryItemId },
  });

  return successResponse({ removed: removed.count });
}
