// POST /api/admin/inventory/search-tool/add — add a vehicle to inventory

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  vin: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int(),
  trim: z.string().optional(),
  price: z.coerce.number(), // dollars — convert to priceCents
  mileage: z.coerce.number(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const data = parsed.data;

  // Check if VIN already exists
  if (data.vin) {
    const existing = await prisma.inventoryItem.findFirst({ where: { vin: data.vin } });
    if (existing) {
      return NextResponse.json({ error: "Vehicle already in inventory", id: existing.id }, { status: 409 });
    }
  }

  const item = await prisma.inventoryItem.create({
    data: {
      vin: data.vin || null,
      make: data.make,
      model: data.model,
      year: data.year,
      trim: data.trim ?? null,
      priceCents: Math.round(data.price * 100),
      mileage: data.mileage,
      images: data.imageUrl ? [data.imageUrl] : [],
      sourceAdapter: "manual_admin",
      lane: "LANE_1",
      isActive: true,
    },
  });

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "STATUS_CHANGE",
      entityType: "InventoryItem",
      entityId: item.id,
      reason: `Manually added vehicle: ${data.year} ${data.make} ${data.model}`,
    },
  }).catch(() => {});

  return NextResponse.json({ success: true, data: { id: item.id } }, { status: 201 });
}
