// POST /api/admin/buyers/[buyerId]/shortlist
// Admin adds a vehicle to a buyer's shortlist.
// Enforces MAX_SHORTLIST_ITEMS (5) limit.
// AuditLog entry created for every addition.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { MAX_SHORTLIST_ITEMS } from "@/lib/constants";

interface Props { params: Promise<{ buyerId: string }> }

const schema = z.object({
  inventoryItemId: z.string().min(1),
  reason:          z.string().min(1),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const shortlist = await prisma.shortlist.findUnique({
    where: { buyerId },
    include: { items: true },
  });

  // Include inventory details so callers (e.g., LaunchAuctionPanel) can render
  // a useful summary without a second round-trip.
  const inventoryIds = (shortlist?.items ?? []).map((i) => i.inventoryItemId);
  const inventoryItems = inventoryIds.length > 0
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: inventoryIds } },
        select: { id: true, year: true, make: true, model: true, trim: true, mileage: true },
      })
    : [];
  const inventoryById = new Map(inventoryItems.map((it) => [it.id, it]));

  const enrichedShortlist = shortlist
    ? {
        ...shortlist,
        items: shortlist.items.map((item) => ({
          ...item,
          inventoryItem: inventoryById.get(item.inventoryItemId) ?? null,
        })),
      }
    : null;

  return adminSuccess({ shortlist: enrichedShortlist, itemCount: shortlist?.items.length ?? 0, maxItems: MAX_SHORTLIST_ITEMS });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return adminError("NOT_FOUND", "Buyer not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { inventoryItemId, reason } = parsed.data;

  // Upsert shortlist record
  const shortlist = await prisma.shortlist.upsert({
    where: { buyerId },
    create: { buyerId },
    update: {},
    include: { items: true },
  });

  // Enforce max shortlist limit
  if (shortlist.items.length >= MAX_SHORTLIST_ITEMS) {
    return adminError(
      "SHORTLIST_FULL",
      `Shortlist is full — max ${MAX_SHORTLIST_ITEMS} items allowed`,
      400,
    );
  }

  // Add item (upsert to prevent duplicates)
  const item = await prisma.shortlistItem.upsert({
    where: { shortlistId_inventoryItemId: { shortlistId: shortlist.id, inventoryItemId } },
    create: { shortlistId: shortlist.id, inventoryItemId, readinessState: "AUCTION_READY" },
    update: { readinessState: "AUCTION_READY" },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "SHORTLIST_ITEM_ADDED",
      entityType: "ShortlistItem",
      entityId: item.id,
      reason,
      metadata: { buyerId, inventoryItemId, shortlistId: shortlist.id },
    },
  });

  const updatedShortlist = await prisma.shortlist.findUnique({
    where: { buyerId },
    include: { items: true },
  });

  return adminSuccess({
    shortlistItemId: item.id,
    shortlistId: shortlist.id,
    itemCount: updatedShortlist?.items.length ?? 1,
    maxItems: MAX_SHORTLIST_ITEMS,
  }, 201);
}
