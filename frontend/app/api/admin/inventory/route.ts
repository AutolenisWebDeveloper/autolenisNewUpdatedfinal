// POST /api/admin/inventory — create single vehicle (manual_admin)
// PATCH /api/admin/inventory — not used (use [id] routes)
// GET /api/admin/inventory — list with filters

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventoryLane } from "@prisma/client";

const createSchema = z.object({
  make:          z.string().min(1),
  model:         z.string().min(1),
  year:          z.number().int().min(2010).max(2026),
  trim:          z.string().optional(),
  vin:           z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 alphanumeric characters").optional().or(z.literal("")),
  priceCents:    z.number().int().positive().max(50_000_000),
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
  lane:          z.nativeEnum(InventoryLane).default("LANE_3"),
  images:        z.array(z.string().url()).max(10).optional(),
});

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const source  = searchParams.get("source");
  const lane    = searchParams.get("lane");
  const make    = searchParams.get("make");
  const status  = searchParams.get("status");
  const cursor  = searchParams.get("cursor");
  const limit   = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  const where: Record<string, unknown> = {};
  if (source) where.sourceAdapter = source;
  if (lane)   where.lane = lane;
  if (make)   where.make = { equals: make, mode: "insensitive" };
  if (status === "active")   where.isActive = true;
  if (status === "inactive") where.isActive = false;

  const items = await prisma.inventoryItem.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const rows    = hasMore ? items.slice(0, limit) : items;
  return adminSuccess({
    items: rows,
    hasMore,
    nextCursor: hasMore ? rows[rows.length - 1]?.id : null,
    count: rows.length,
  });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  const data = parsed.data;

  // Check duplicate VIN
  if (data.vin) {
    const existing = await prisma.inventoryItem.findUnique({ where: { vin: data.vin } });
    if (existing) return adminError("DUPLICATE_VIN", `VIN ${data.vin} already exists (id: ${existing.id})`, 409);
  }

  const item = await prisma.inventoryItem.create({
    data: {
      make:           data.make,
      model:          data.model,
      year:           data.year,
      trim:           data.trim ?? null,
      vin:            data.vin || null,
      priceCents:     data.priceCents,
      mileage:        data.mileage ?? null,
      condition:      data.condition ?? null,
      bodyType:       data.bodyType ?? null,
      exteriorColor:  data.exteriorColor ?? null,
      interiorColor:  data.interiorColor ?? null,
      engine:         data.engine ?? null,
      transmission:   data.transmission ?? null,
      drivetrain:     data.drivetrain ?? null,
      fuelType:       data.fuelType ?? null,
      city:           data.city ?? null,
      state:          data.state ?? null,
      zip:            data.zip ?? null,
      description:    data.description ?? null,
      lane:           data.lane,
      images:         data.images ?? [],
      sourceAdapter:  "manual_admin",
      addedByAdminId: admin.adminId,
      isActive:       true,
      lastSeenAt:     new Date(),
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "INVENTORY_ITEM_CREATED",
      entityType: "InventoryItem",
      entityId: item.id,
      reason: "Manual admin entry",
      metadata: { vin: item.vin, year: item.year, make: item.make, model: item.model },
    },
  });

  return adminSuccess({ item: { id: item.id, make: item.make, model: item.model, year: item.year, vin: item.vin } }, 201);
}
