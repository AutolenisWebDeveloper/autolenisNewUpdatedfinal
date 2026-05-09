import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";

// POST /api/buyer/shortlist — add item
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { inventoryItemId } = await request.json() as { inventoryItemId: string };
  if (!inventoryItemId) return errorResponse("VALIDATION_ERROR", "inventoryItemId is required", 400);

  // Verify vehicle exists
  const vehicle = await prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } });
  if (!vehicle) return errorResponse("NOT_FOUND", "Vehicle not found", 404);

  // Get or create shortlist
  const shortlist = await prisma.shortlist.upsert({
    where: { buyerId: buyer.id },
    create: { buyerId: buyer.id },
    update: {},
    include: { items: true },
  });

  // MAX_SHORTLIST_ITEMS enforcement
  if (shortlist.items.length >= MAX_SHORTLIST_ITEMS) {
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
