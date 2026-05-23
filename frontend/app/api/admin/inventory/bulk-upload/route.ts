// POST /api/admin/inventory/bulk-upload
// Accepts pre-parsed CSV rows, validates each, creates InventoryItem records.
// Returns summary: succeeded, failed, errors per row.

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { InventoryLane } from "@prisma/client";

const rowSchema = z.object({
  make:          z.string().min(1, "make required"),
  model:         z.string().min(1, "model required"),
  year:          z.preprocess(Number, z.number().int().min(2010).max(2026)),
  trim:          z.string().optional(),
  vin:           z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "Invalid VIN").optional().or(z.literal("")).optional(),
  priceCents:    z.preprocess(Number, z.number().int().positive("price must be positive").max(50_000_000)),
  mileage:       z.preprocess(v => v === "" || v === undefined ? undefined : Number(v), z.number().int().min(0).optional()),
  condition:     z.string().optional(),
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
  lane:          z.preprocess(
    v => (v && typeof v === "string" && ["LANE_1","LANE_2","LANE_3"].includes(v as string) ? v : "LANE_3"),
    z.nativeEnum(InventoryLane)
  ).optional(),
});

const bulkSchema = z.object({
  rows:     z.array(z.record(z.string())).min(1).max(500),
  filename: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return adminError("VALIDATION_ERROR", "Invalid JSON", 400); }
  const outer = bulkSchema.safeParse(body);
  if (!outer.success) return adminError("VALIDATION_ERROR", outer.error.issues[0]?.message ?? "Invalid input", 400);

  const { rows, filename } = outer.data;
  const results: { row: number; status: "success" | "error"; id?: string; error?: string }[] = [];
  let successCount = 0;
  let failureCount = 0;

  // Pre-load existing VINs to detect duplicates within the batch
  const existingVins = new Set(
    (await prisma.inventoryItem.findMany({ where: { vin: { not: null } }, select: { vin: true } }))
      .map(i => i.vin!)
  );
  const batchVins = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const parsed = rowSchema.safeParse(raw);

    if (!parsed.success) {
      results.push({ row: i + 1, status: "error", error: parsed.error.issues[0]?.message ?? "Invalid row" });
      failureCount++;
      continue;
    }

    const d = parsed.data;

    // Duplicate VIN check (DB + within-batch)
    if (d.vin) {
      if (existingVins.has(d.vin) || batchVins.has(d.vin)) {
        results.push({ row: i + 1, status: "error", error: `Duplicate VIN: ${d.vin}` });
        failureCount++;
        continue;
      }
      batchVins.add(d.vin);
    }

    try {
      const item = await prisma.inventoryItem.create({
        data: {
          make:           d.make,
          model:          d.model,
          year:           d.year,
          trim:           d.trim ?? null,
          vin:            d.vin || null,
          priceCents:     d.priceCents,
          mileage:        d.mileage ?? null,
          condition:      d.condition ?? null,
          bodyType:       d.bodyType ?? null,
          exteriorColor:  d.exteriorColor ?? null,
          interiorColor:  d.interiorColor ?? null,
          engine:         d.engine ?? null,
          transmission:   d.transmission ?? null,
          drivetrain:     d.drivetrain ?? null,
          fuelType:       d.fuelType ?? null,
          city:           d.city ?? null,
          state:          d.state ?? null,
          zip:            d.zip ?? null,
          description:    d.description ?? null,
          lane:           d.lane ?? "LANE_3",
          images:         [],
          sourceAdapter:  "csv_upload_admin",
          addedByAdminId: admin.adminId,
          isActive:       true,
          lastSeenAt:     new Date(),
        },
      });
      if (d.vin) existingVins.add(d.vin);
      results.push({ row: i + 1, status: "success", id: item.id });
      successCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Create failed";
      results.push({ row: i + 1, status: "error", error: msg });
      failureCount++;
    }
  }

  // Record upload batch history
  const batch = await prisma.inventoryUploadBatch.create({
    data: {
      adminId:      admin.adminId,
      adminEmail:   admin.email,
      filename:     filename ?? null,
      totalRows:    rows.length,
      successCount,
      failureCount,
      status:       "COMPLETED",
      errors:       results.filter(r => r.status === "error"),
    },
  });

  await createAuditLog(admin, request, {
    action: "INVENTORY_BULK_UPLOAD",
    entityType: "InventoryUploadBatch",
    entityId: batch.id,
    metadata: { totalRows: rows.length, successCount, failureCount, filename: filename ?? null },
  });

  return adminSuccess({
    batchId:     batch.id,
    totalRows:   rows.length,
    successCount,
    failureCount,
    results,
  }, 201);
}
