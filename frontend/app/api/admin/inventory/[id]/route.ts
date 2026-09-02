// GET/PATCH/DELETE /api/admin/inventory/[id]

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventoryLane } from "@prisma/client";

interface Props { params: Promise<{ id: string }> }

const updateSchema = z.object({
  make:          z.string().min(1).optional(),
  model:         z.string().min(1).optional(),
  year:          z.number().int().min(2010).max(2026).optional(),
  trim:          z.string().optional(),
  vin:           z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/).optional().or(z.literal("")).optional(),
  priceCents:    z.number().int().positive().max(50_000_000).optional(),
  mileage:       z.number().int().min(0).optional(),
  condition:     z.enum(["new", "used"]).optional(),
  bodyType:      z.string().optional(),
  exteriorColor: z.string().optional(),
  interiorColor: z.string().optional(),
  engine:        z.string().optional(),
  transmission:  z.string().optional(),
  drivetrain:    z.string().optional(),
  fuelType:      z.string().optional(),
  city:          z.string().optional(),
  state:         z.string().optional(),
  zip:           z.string().optional(),
  description:   z.string().optional(),
  lane:          z.nativeEnum(InventoryLane).optional(),
  images:        z.array(z.string()).max(10).optional(),
  isActive:      z.boolean().optional(),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return adminError("NOT_FOUND", "Vehicle not found", 404);
  return adminSuccess({ item });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const existing = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Vehicle not found", 404);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const data = parsed.data;

  // Duplicate VIN check
  if (data.vin && data.vin !== existing.vin) {
    const conflict = await prisma.inventoryItem.findFirst({ where: { vin: data.vin, id: { not: id } } });
    if (conflict) return adminError("DUPLICATE_VIN", `VIN ${data.vin} already exists on another vehicle`, 409);
  }

  const updated = await prisma.inventoryItem.update({
    where: { id },
    data: {
      ...(data.make          !== undefined ? { make: data.make } : {}),
      ...(data.model         !== undefined ? { model: data.model } : {}),
      ...(data.year          !== undefined ? { year: data.year } : {}),
      ...(data.trim          !== undefined ? { trim: data.trim } : {}),
      ...(data.vin           !== undefined ? { vin: data.vin || null } : {}),
      ...(data.priceCents    !== undefined ? { priceCents: data.priceCents } : {}),
      ...(data.mileage       !== undefined ? { mileage: data.mileage } : {}),
      ...(data.condition     !== undefined ? { condition: data.condition } : {}),
      ...(data.bodyType      !== undefined ? { bodyType: data.bodyType } : {}),
      ...(data.exteriorColor !== undefined ? { exteriorColor: data.exteriorColor } : {}),
      ...(data.interiorColor !== undefined ? { interiorColor: data.interiorColor } : {}),
      ...(data.engine        !== undefined ? { engine: data.engine } : {}),
      ...(data.transmission  !== undefined ? { transmission: data.transmission } : {}),
      ...(data.drivetrain    !== undefined ? { drivetrain: data.drivetrain } : {}),
      ...(data.fuelType      !== undefined ? { fuelType: data.fuelType } : {}),
      ...(data.city          !== undefined ? { city: data.city } : {}),
      ...(data.state         !== undefined ? { state: data.state } : {}),
      ...(data.zip           !== undefined ? { zip: data.zip } : {}),
      ...(data.description   !== undefined ? { description: data.description } : {}),
      ...(data.lane          !== undefined ? { lane: data.lane } : {}),
      ...(data.images        !== undefined ? { images: data.images } : {}),
      ...(data.isActive      !== undefined ? { isActive: data.isActive } : {}),
      // An admin edit is a human confirming the listing, so it refreshes freshness
      // the same way a feed sighting does (see inventory-eligibility.ts). Setting
      // the lane also records WHO curated the row: `lane` alone is not evidence of
      // curation, and a lane change with no attribution is exactly what produced
      // the 95 LANE_1 rows with no dealer that the stale sweep could never reach.
      lastSeenAt: new Date(),
      ...(data.lane !== undefined ? { addedByAdminId: admin.adminId } : {}),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "INVENTORY_ITEM_UPDATED",
      entityType: "InventoryItem",
      entityId: id,
      reason: "Admin edit",
      metadata: { fields: Object.keys(data) },
    },
  });

  return adminSuccess({ item: { id: updated.id, make: updated.make, model: updated.model } });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const confirmation = (body as Record<string, string>)?.confirmation;
  if (confirmation !== "DELETE") return adminError("CONFIRMATION_REQUIRED", "Must send confirmation: 'DELETE'", 400);

  const existing = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!existing) return adminError("NOT_FOUND", "Vehicle not found", 404);

  await prisma.inventoryItem.delete({ where: { id } });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "INVENTORY_ITEM_DELETED",
      entityType: "InventoryItem",
      entityId: id,
      reason: "Admin permanent delete",
      metadata: { vin: existing.vin, year: existing.year, make: existing.make, model: existing.model },
    },
  });

  return adminSuccess({ deleted: true, id });
}
