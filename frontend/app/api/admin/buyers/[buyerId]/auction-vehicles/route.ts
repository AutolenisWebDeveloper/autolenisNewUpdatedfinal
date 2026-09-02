import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { isShortlistItemAvailable } from "@/lib/services/shortlist/shortlist-availability";

interface Props { params: Promise<{ buyerId: string }> }

const vehicleSchema = z.object({
  inventoryItemId: z.string().min(1).optional(),
  year:    z.number().int().min(1900).max(2100).optional(),
  make:    z.string().min(1).optional(),
  model:   z.string().min(1).optional(),
  trim:    z.string().optional(),
  mileage: z.number().int().min(0).optional(),
  notes:   z.string().max(2000).optional(),
}).refine(
  v => v.inventoryItemId || (v.year && v.make && v.model),
  "Each vehicle needs an inventoryItemId or at minimum year+make+model",
);

const postSchema = z.object({
  auctionId: z.string().min(1),
  vehicles:  z.array(vehicleSchema).min(1, "At least one vehicle is required").max(10),
});

export async function GET(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { buyerId } = await params;

  const auction = await prisma.auction.findFirst({
    where: { buyerId, status: { in: ["PENDING", "ACTIVE"] } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!auction) return adminSuccess({ auctionId: null, vehicles: [] });

  const vehicles = await prisma.auctionVehicle.findMany({
    where: { auctionId: auction.id },
    orderBy: { createdAt: "asc" },
    include: { inventoryItem: { select: { id: true, year: true, make: true, model: true, trim: true, mileage: true } } },
  });

  return adminSuccess({ auctionId: auction.id, vehicles });
}

export async function POST(request: NextRequest, { params }: Props) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!["SUPER_ADMIN", "OPERATIONS_ADMIN"].includes(admin.role)) {
    return adminError("FORBIDDEN", "SUPER_ADMIN or OPERATIONS_ADMIN required", 403);
  }

  const { buyerId } = await params;

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { auctionId, vehicles } = parsed.data;

  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId },
    select: { id: true },
  });
  if (!auction) return adminError("NOT_FOUND", "Auction not found for this buyer", 404);

  // An unavailable vehicle must never be carried into an auction. Dealers would be invited
  // to bid on a car that has left the market, and the buyer would be shown offers on
  // something they cannot buy. Free-form entries (no inventoryItemId) are unaffected —
  // those are concierge-sourced and have no listing to go stale.
  const linkedIds = vehicles
    .map(v => v.inventoryItemId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (linkedIds.length > 0) {
    const rows = await prisma.inventoryItem.findMany({
      where: { id: { in: linkedIds } },
      select: { id: true, isActive: true, priceCents: true },
    });
    const byId = new Map(rows.map(r => [r.id, r]));
    const unavailable = linkedIds.filter(id => !isShortlistItemAvailable(byId.get(id) ?? null));
    if (unavailable.length > 0) {
      return adminError(
        "VALIDATION_ERROR",
        `${unavailable.length} vehicle(s) are no longer available and cannot be auctioned: ` +
        `${unavailable.slice(0, 10).join(", ")}` +
        `${unavailable.length > 10 ? ` (+${unavailable.length - 10} more)` : ""}`,
        400,
      );
    }
  }

  const created = await prisma.auctionVehicle.createMany({
    data: vehicles.map(v => ({
      auctionId,
      inventoryItemId: v.inventoryItemId ?? null,
      year:    v.year    ?? null,
      make:    v.make    ?? null,
      model:   v.model   ?? null,
      trim:    v.trim    ?? null,
      mileage: v.mileage ?? null,
      notes:   v.notes   ?? null,
    })),
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "AUCTION_VEHICLES_ATTACHED",
      entityType: "Auction",
      entityId: auctionId,
      reason: "Vehicles attached to auction",
      metadata: { buyerId, auctionId, vehicleCount: vehicles.length },
    },
  }).catch(err => logger.error("[auction-vehicles] audit log failed:", err));

  return adminSuccess({ attached: created.count });
}
