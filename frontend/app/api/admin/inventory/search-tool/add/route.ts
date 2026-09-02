// POST /api/admin/inventory/search-tool/add — add a vehicle to inventory

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
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
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }

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
      // Attribution and freshness, both previously unset. Without addedByAdminId a
      // deliberately curated row is indistinguishable from an orphan — and it is
      // exactly what exempts it from the stale sweep (see isSweepExempt in
      // lib/services/inventory/inventory-eligibility.ts). Without lastSeenAt the
      // row has no age at all: `lastSeenAt < cutoff` is UNKNOWN for NULL, which is
      // how 95 rows stayed active for four months.
      addedByAdminId: admin.adminId,
      lastSeenAt: new Date(),
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
