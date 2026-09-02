// PATCH /api/admin/inventory/bulk-lane — move many vehicles to a lane in one action

import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, getClientIp, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventoryLane } from "@prisma/client";

// Cap per request to keep the single round-trip fast and bound DB load.
const MAX_BATCH = 500;

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one vehicle").max(MAX_BATCH, `Cannot move more than ${MAX_BATCH} vehicles at once`),
  lane: z.nativeEnum(InventoryLane),
});

export async function PATCH(request: NextRequest) {
  const admin = await getAdminWithRole(request, OPERATIONAL_ROLES);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated or insufficient permissions", 401);

  let raw: unknown;
  try { raw = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const { lane } = parsed.data;
  // De-duplicate ids defensively.
  const ids = Array.from(new Set(parsed.data.ids));

  // Snapshot current lanes for audit integrity (only items that actually exist).
  const existing = await prisma.inventoryItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, lane: true, vin: true, dealerId: true },
  });

  if (existing.length === 0) return adminError("NOT_FOUND", "No matching vehicles found", 404);

  // LANE_1 is a two-part claim: an active AutoLenis dealer AND an explicitly linked
  // vehicle. This route is the live mechanism by which an operator could manufacture the
  // phantom class — LANE_1 with no dealer — that the stale sweep's `lane != LANE_1` guard
  // then protected forever, and that renders a "verified dealer partner" badge for a car
  // with no dealer relationship. Reject rather than silently minting one.
  if (lane === InventoryLane.LANE_1) {
    const withoutDealer = existing.filter(it => it.dealerId === null).map(it => it.id);
    if (withoutDealer.length > 0) {
      return adminError(
        "VALIDATION_ERROR",
        `LANE_1 requires a linked dealer. ${withoutDealer.length} of ${existing.length} selected ` +
        `vehicle(s) have no dealer: ${withoutDealer.slice(0, 10).join(", ")}` +
        `${withoutDealer.length > 10 ? ` (+${withoutDealer.length - 10} more)` : ""}`,
        400,
      );
    }
  }

  // Only update the items that need to change lanes.
  const toMove = existing.filter(it => it.lane !== lane);
  const movedIds = toMove.map(it => it.id);
  const missing = ids.filter(id => !existing.some(it => it.id === id));

  const ipAddress = getClientIp(request);

  // Single atomic transaction: bulk update + bulk audit log for data integrity.
  if (movedIds.length > 0) {
    await prisma.$transaction([
      prisma.inventoryItem.updateMany({
        where: { id: { in: movedIds } },
        data: { lane },
      }),
      prisma.adminAuditLog.createMany({
        data: toMove.map(it => ({
          adminId: admin.adminId,
          adminEmail: admin.email,
          action: "INVENTORY_ITEM_LANE_CHANGED",
          entityType: "InventoryItem",
          entityId: it.id,
          reason: "Admin bulk lane move",
          ipAddress,
          metadata: { vin: it.vin, fromLane: it.lane, toLane: lane },
        })),
      }),
    ]);
  }

  return adminSuccess({
    lane,
    requested: ids.length,
    moved: movedIds.length,
    unchanged: existing.length - movedIds.length,
    notFound: missing.length,
    movedIds,
  });
}
