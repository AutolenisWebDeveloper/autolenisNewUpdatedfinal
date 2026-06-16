// POST /api/dealer/inventory/bulk — bulk create inventory items from parsed CSV rows.
//
// Two body shapes supported:
//   1. Typed rows (legacy, headers already mapped client-side):
//        { rows: Array<{ vin, year, make, model, trim?, priceCents, mileage? }> }
//   2. Raw rows (CSV headers preserved, server applies the dealer's saved mapping
//      from the al_dealer_csv_mapping cookie set by /api/dealer/inventory/column-mapping):
//        { rawRows: Array<Record<string, string>> }
//
// Dedupes by VIN (skips existing), returns { created, skipped, errors? }.
import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const STANDARD_FIELDS = ["VIN", "Year", "Make", "Model", "Trim", "Mileage", "Price", "Skip"] as const;
type StandardField = (typeof STANDARD_FIELDS)[number];
const COOKIE_NAME = "al_dealer_csv_mapping";

const rowSchema = z.object({
  vin: z.string().min(11).max(17),
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  trim: z.string().max(64).optional(),
  priceCents: z.number().int().positive(),
  mileage: z.number().int().nonnegative().optional(),
});

const bodySchema = z.union([
  z.object({ rows: z.array(rowSchema).min(1).max(500) }),
  z.object({
    rawRows: z.array(z.record(z.string(), z.string())).min(1).max(500),
  }),
]);

type TypedRow = z.infer<typeof rowSchema>;

function readMappingCookie(request: NextRequest): Record<string, StandardField> | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const validFields = new Set(STANDARD_FIELDS);
    const out: Record<string, StandardField> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && validFields.has(v as StandardField)) {
        out[k] = v as StandardField;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function applyRawRows(
  rawRows: Array<Record<string, string>>,
  mapping: Record<string, StandardField>,
): { typedRows: TypedRow[]; errors: string[] } {
  const typedRows: TypedRow[] = [];
  const errors: string[] = [];

  for (const [idx, raw] of rawRows.entries()) {
    const picked: Partial<Record<StandardField, string>> = {};
    for (const [csvCol, field] of Object.entries(mapping)) {
      if (field === "Skip") continue;
      const v = raw[csvCol];
      if (v !== undefined && v !== "") picked[field] = v.trim();
    }

    const vin = picked.VIN;
    const yearStr = picked.Year;
    const make = picked.Make;
    const model = picked.Model;
    const priceStr = picked.Price;

    if (!vin) { errors.push(`Row ${idx + 1}: missing VIN`); continue; }
    if (vin.length < 11 || vin.length > 17) { errors.push(`Row ${idx + 1}: invalid VIN length (${vin})`); continue; }
    if (!yearStr) { errors.push(`Row ${idx + 1}: missing Year for VIN ${vin}`); continue; }
    if (!make) { errors.push(`Row ${idx + 1}: missing Make for VIN ${vin}`); continue; }
    if (!model) { errors.push(`Row ${idx + 1}: missing Model for VIN ${vin}`); continue; }
    if (!priceStr) { errors.push(`Row ${idx + 1}: missing Price for VIN ${vin}`); continue; }

    const year = parseInt(yearStr, 10);
    if (Number.isNaN(year) || year < 1900 || year > 2100) {
      errors.push(`Row ${idx + 1}: invalid Year "${yearStr}" for VIN ${vin}`);
      continue;
    }
    const priceNum = parseFloat(priceStr.replace(/[$,]/g, ""));
    if (Number.isNaN(priceNum) || priceNum <= 0) {
      errors.push(`Row ${idx + 1}: invalid Price "${priceStr}" for VIN ${vin}`);
      continue;
    }

    let mileage: number | undefined;
    if (picked.Mileage) {
      const m = parseInt(picked.Mileage.replace(/,/g, ""), 10);
      if (!Number.isNaN(m) && m >= 0) mileage = m;
    }

    typedRows.push({
      vin,
      year,
      make,
      model,
      trim: picked.Trim,
      priceCents: Math.round(priceNum * 100),
      mileage,
    });
  }

  return { typedRows, errors };
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 422);
  }

  let rows: TypedRow[];
  let preErrors: string[] = [];

  if ("rows" in parsed.data) {
    rows = parsed.data.rows;
  } else {
    const mapping = readMappingCookie(request);
    if (!mapping) {
      return errorResponse(
        "MAPPING_REQUIRED",
        "No saved column mapping. Visit /dealer/inventory/column-mapping first.",
        409,
      );
    }
    const { typedRows, errors } = applyRawRows(parsed.data.rawRows, mapping);
    rows = typedRows;
    preErrors = errors;
    if (rows.length === 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        `No valid rows after applying mapping. First error: ${errors[0] ?? "(none)"}`,
        422,
      );
    }
  }

  // Dedupe by VIN within the submitted rows
  const seenVins = new Set<string>();
  const uniqueRows = rows.filter((r) => {
    if (seenVins.has(r.vin)) return false;
    seenVins.add(r.vin);
    return true;
  });

  // Find VINs that already exist in DB for this dealer (only non-null VINs)
  const existingItems = await prisma.inventoryItem.findMany({
    where: {
      dealerId: dealer.id,
      vin: { in: uniqueRows.map((r) => r.vin), not: null },
    },
    select: { vin: true },
  });
  const existingVins = new Set<string>(
    existingItems.map((i) => i.vin).filter((v): v is string => v !== null),
  );

  const toCreate = uniqueRows.filter((r) => !existingVins.has(r.vin));
  const skipped = uniqueRows.length - toCreate.length;

  let created = 0;
  if (toCreate.length > 0) {
    try {
      const result = await prisma.inventoryItem.createMany({
        data: toCreate.map((r) => ({
          dealerId: dealer.id,
          lane: "LANE_1" as const,
          vin: r.vin,
          year: r.year,
          make: r.make,
          model: r.model,
          trim: r.trim,
          priceCents: r.priceCents,
          mileage: r.mileage,
          images: [],
          isActive: true,
        })),
        skipDuplicates: true,
      });
      created = result.count;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        return errorResponse("DB_ERROR", "Could not save inventory items", 500);
      }
      logger.error("[dealer/inventory/bulk POST]", err);
      return errorResponse("DB_ERROR", "Could not save inventory items", 500);
    }
  }

  return successResponse(
    {
      created,
      skipped: skipped + (toCreate.length - created),
      mappingErrors: preErrors.length,
      ...(preErrors.length > 0 ? { mappingErrorDetails: preErrors.slice(0, 5) } : {}),
    },
    201,
  );
}
