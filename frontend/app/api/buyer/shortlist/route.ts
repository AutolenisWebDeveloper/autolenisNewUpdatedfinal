// /api/buyer/shortlist — the buyer's saved candidates.
//
// THIN BY DESIGN (Phase 4). The gate, the cap, the duplicate check, the distance snapshot and
// the refusal vocabulary all live in `lib/services/shortlist/shortlist.service.ts`. They used
// to live HERE, duplicated against a second, ungated writer in that same service — so a caller
// reaching the service directly bypassed the radius and freshness rules entirely.
//
// The service's refusal code IS the API's error code: one vocabulary shared by the card, the
// server and the tests, so they cannot disagree about why an action is unavailable.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { addToShortlist, removeFromShortlist } from "@/lib/services/shortlist/shortlist.service";

// POST /api/buyer/shortlist — add item
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { inventoryItemId } = (await request.json()) as { inventoryItemId?: string };
  if (!inventoryItemId) return errorResponse("VALIDATION_ERROR", "inventoryItemId is required", 400);

  const result = await addToShortlist(buyer.id, inventoryItemId);
  if (!result.ok) {
    // NOT_FOUND is the one refusal that is a 404 rather than a 400: the resource is absent,
    // not the request malformed.
    return errorResponse(result.code, result.message, result.code === "NOT_FOUND" ? 404 : 400);
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

  return successResponse({ items: shortlist?.items ?? [], count: shortlist?.items.length ?? 0 });
}

// DELETE /api/buyer/shortlist?inventoryItemId=...  — remove item
export async function DELETE(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const inventoryItemId = searchParams.get("inventoryItemId");
  const itemId = searchParams.get("itemId");
  if (!inventoryItemId && !itemId) {
    return errorResponse("VALIDATION_ERROR", "inventoryItemId or itemId is required", 400);
  }

  const { removed } = await removeFromShortlist(buyer.id, {
    inventoryItemId: inventoryItemId ?? undefined,
    itemId: itemId ?? undefined,
  });
  return successResponse({ removed });
}
