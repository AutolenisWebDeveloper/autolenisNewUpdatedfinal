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
      // LANE_3, not LANE_1. LANE_1 asserts an active AutoLenis dealer AND an explicitly
      // linked vehicle; this row has no dealerId, so the label was false and it drove a
      // "Verified — directly from a verified AutoLenis dealer partner" badge for a car
      // with no dealer relationship. This route is also how the 95 phantom LANE_1 rows in
      // production were minted, which the stale sweep's `lane != LANE_1` guard then
      // protected forever.
      lane: "LANE_3",
      // Stamps the curator so the stale sweep can exempt this row on the invariant
      // (admin-entered vehicles have no feed to be re-seen in) rather than on provenance
      // string matching.
      addedByAdminId: admin.adminId,
      // Without this, lastSeenAt is NULL and the row is invisible to every freshness
      // query — the second defect behind the un-sweepable production rows.
      lastSeenAt: new Date(),
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
