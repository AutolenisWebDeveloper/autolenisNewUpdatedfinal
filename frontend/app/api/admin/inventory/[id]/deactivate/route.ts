// PATCH /api/admin/inventory/[id]/deactivate — set isActive = false

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const activate = (body as Record<string, boolean>)?.activate === true;

  const existing = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Vehicle not found", 404);

  const updated = await prisma.inventoryItem.update({
    where: { id },
    data: { isActive: activate },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: activate ? "INVENTORY_ITEM_ACTIVATED" : "INVENTORY_ITEM_DEACTIVATED",
      entityType: "InventoryItem",
      entityId: id,
      reason: activate ? "Admin reactivated" : "Admin deactivated",
      metadata: { vin: existing.vin, previousStatus: existing.isActive, newStatus: updated.isActive },
    },
  });

  return adminSuccess({ id, isActive: updated.isActive });
}
