// POST /api/dealer/inventory/column-mapping
//
// Two modes (both backward-compatible with the existing client):
//   1. mapping-only — { mapping }: persists the dealer's chosen CSV-column → field
//      mapping in an HttpOnly dealer-scoped cookie. Used by the
//      /dealer/inventory/column-mapping configuration page.
//   2. mapping+rows — { mapping, rows }: also creates InventoryItem records by
//      applying the mapping to each row (requires VIN + Year + Make + Model at minimum).
//
// Standard fields the mapping value may take: VIN, Year, Make, Model, Trim,
// Mileage, Price, Skip.
import { NextRequest, NextResponse } from "next/server";
import { getRequestDealer, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const STANDARD_FIELD = z.enum([
  "VIN",
  "Year",
  "Make",
  "Model",
  "Trim",
  "Mileage",
  "Price",
  "Skip",
]);
type StandardField = z.infer<typeof STANDARD_FIELD>;

const bodySchema = z.object({
  mapping: z.record(z.string().min(1).max(128), STANDARD_FIELD),
  rows: z.array(z.record(z.string(), z.string())).max(500).optional(),
});

const COOKIE_NAME = "al_dealer_csv_mapping";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ─── Helpers ─────────────────────────────────────────────────────────────────

function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, StandardField>,
): Partial<Record<StandardField, string>> {
  const out: Partial<Record<StandardField, string>> = {};
  for (const [csvCol, field] of Object.entries(mapping)) {
    if (field === "Skip") continue;
    const value = row[csvCol];
    if (value !== undefined && value !== "") out[field] = value.trim();
  }
  return out;
}

function rowToInventoryCreate(
  mapped: Partial<Record<StandardField, string>>,
  dealerId: string,
):
  | { ok: true; data: Prisma.InventoryItemCreateManyInput }
  | { ok: false; error: string } {
  const vin = mapped.VIN;
  const yearStr = mapped.Year;
  const make = mapped.Make;
  const model = mapped.Model;

  if (!vin) return { ok: false, error: "Missing VIN" };
  if (vin.length < 11 || vin.length > 17) return { ok: false, error: `Invalid VIN length: ${vin}` };
  if (!yearStr) return { ok: false, error: `Missing Year for VIN ${vin}` };
  if (!make) return { ok: false, error: `Missing Make for VIN ${vin}` };
  if (!model) return { ok: false, error: `Missing Model for VIN ${vin}` };

  const year = parseInt(yearStr, 10);
  if (Number.isNaN(year) || year < 1900 || year > 2100) {
    return { ok: false, error: `Invalid Year "${yearStr}" for VIN ${vin}` };
  }

  // Price: required by Prisma model (priceCents Int — non-null)
  const priceStr = mapped.Price;
  if (!priceStr) return { ok: false, error: `Missing Price for VIN ${vin}` };
  const priceNum = parseFloat(priceStr.replace(/[$,]/g, ""));
  if (Number.isNaN(priceNum) || priceNum <= 0) {
    return { ok: false, error: `Invalid Price "${priceStr}" for VIN ${vin}` };
  }
  const priceCents = Math.round(priceNum * 100);

  let mileage: number | undefined;
  if (mapped.Mileage) {
    const m = parseInt(mapped.Mileage.replace(/[,]/g, ""), 10);
    if (!Number.isNaN(m) && m >= 0) mileage = m;
  }

  return {
    ok: true,
    data: {
      dealerId,
      lane: "LANE_1" as const,
      vin,
      year,
      make,
      model,
      trim: mapped.Trim,
      mileage,
      priceCents,
      images: [],
      isActive: true,
    },
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Invalid request body",
      422,
    );
  }

  const { mapping, rows } = parsed.data;

  // At least one column must map to a non-Skip field, otherwise the mapping is useless.
  const usefulMappings = Object.values(mapping).filter((v) => v !== "Skip");
  if (usefulMappings.length === 0) {
    return errorResponse(
      "VALIDATION_ERROR",
      "At least one column must be mapped to a field other than Skip",
      422,
    );
  }

  // Mode 2: mapping + rows → import inventory items
  let importResult: { created: number; errors: number; errorDetails: string[] } | null = null;
  if (rows && rows.length > 0) {
    const errorDetails: string[] = [];
    const toCreate: Prisma.InventoryItemCreateManyInput[] = [];
    const seenVins = new Set<string>();

    for (const row of rows) {
      const mapped = applyMapping(row, mapping);
      const result = rowToInventoryCreate(mapped, dealer.id);
      if (!result.ok) {
        errorDetails.push(result.error);
        continue;
      }
      if (result.data.vin && seenVins.has(result.data.vin)) {
        errorDetails.push(`Duplicate VIN in upload: ${result.data.vin}`);
        continue;
      }
      if (result.data.vin) seenVins.add(result.data.vin);
      toCreate.push(result.data);
    }

    let created = 0;
    if (toCreate.length > 0) {
      try {
        const result = await prisma.inventoryItem.createMany({
          data: toCreate,
          skipDuplicates: true, // dedupes against existing VINs in DB
        });
        created = result.count;
      } catch (err) {
        console.error("[dealer/inventory/column-mapping] createMany failed:", err);
        return errorResponse("DB_ERROR", "Could not save inventory items", 500);
      }
    }

    importResult = {
      created,
      errors: errorDetails.length + (toCreate.length - created),
      errorDetails: errorDetails.slice(0, 5),
    };
  }

  const response = NextResponse.json(
    {
      success: true,
      data: {
        saved: true,
        mappedColumns: Object.keys(mapping).length,
        ...(importResult ?? {}),
      },
    },
    { status: importResult && importResult.created > 0 ? 201 : 200 },
  );

  response.cookies.set(COOKIE_NAME, JSON.stringify(mapping), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/dealer",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}
