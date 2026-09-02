import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { addToShortlist, type AddToShortlistFailure } from "@/lib/services/shortlist/shortlist.service";
import { listingFreshness } from "@/lib/services/inventory/inventory-eligibility";

// Each service-level failure maps to its own error code and status. This handler
// used to reimplement the whole add flow inline, which is why the service it
// duplicated had no callers and no eligibility gate could be added in one place.
const FAILURE_STATUS: Record<AddToShortlistFailure, { code: string; status: number }> = {
  VEHICLE_NOT_FOUND: { code: "NOT_FOUND", status: 404 },
  SHORTLIST_FULL: { code: "SHORTLIST_FULL", status: 400 },
  ALREADY_IN_SHORTLIST: { code: "ALREADY_IN_SHORTLIST", status: 400 },
  LISTING_NOT_SHORTLIST_ELIGIBLE: { code: "LISTING_NOT_SHORTLIST_ELIGIBLE", status: 409 },
};

// POST /api/buyer/shortlist — add item
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { inventoryItemId } = await request.json() as { inventoryItemId: string };
  if (!inventoryItemId) return errorResponse("VALIDATION_ERROR", "inventoryItemId is required", 400);

  const result = await addToShortlist(buyer.id, inventoryItemId);
  if (!result.ok) {
    const { code, status } = FAILURE_STATUS[result.reason];
    return errorResponse(code, result.message, status);
  }

  return successResponse({ item: result.item });
}

// GET /api/buyer/shortlist
export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const shortlist = await prisma.shortlist.findUnique({
    where: { buyerId: buyer.id },
    include: { items: true },
  });
  const items = shortlist?.items ?? [];

  // Freshness is a LABEL here, never a filter: a shortlisted vehicle that has
  // since gone stale stays in the list and is marked, rather than vanishing.
  const now = new Date();
  const vehicles = items.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: items.map((i) => i.inventoryItemId) } },
        select: { id: true, isActive: true, lastSeenAt: true, createdAt: true },
      })
    : [];
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  const withFreshness = items.map((item) => {
    const vehicle = byId.get(item.inventoryItemId);
    if (!vehicle) return { ...item, freshness: null };
    const f = listingFreshness(vehicle, now);
    return {
      ...item,
      freshness: {
        lastSeenAt: f.lastSeenAt,
        isStale: f.isStale,
        shortlistEligible: vehicle.isActive && f.shortlistEligible,
      },
    };
  });

  return successResponse({ items: withFreshness, count: items.length });
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
