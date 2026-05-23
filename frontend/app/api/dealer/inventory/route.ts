import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { isValidVin, normalizeVin } from "@/lib/utils/vin";

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  // Soft-deleted (archived) items remain queryable for audit. isActive=false
  // is the archive flag — they are returned with status so the UI can show
  // them in an archive section.
  const inventory = await prisma.inventoryItem.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
  });
  return successResponse({ inventory });
}

const createSchema = z.object({
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  trim: z.string().max(64).optional(),
  priceCents: z.number().int().positive(),
  vin: z.string().transform((s) => normalizeVin(s)).refine(isValidVin, {
    message: "VIN must be exactly 17 alphanumeric characters (no I, O, or Q)",
  }),
  mileage: z.number().int().nonnegative().optional(),
  condition: z.enum(["NEW", "USED", "CPO"]).optional(),
  images: z.array(z.string().url()).max(20).optional(),
}).strict();

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 422);
  }

  // Dealer-scoped duplicate VIN guard. The InventoryItem.vin column is
  // globally @unique, but check upfront so we can return a clean 409
  // instead of waiting for a P2002.
  const existing = await prisma.inventoryItem.findFirst({
    where: { dealerId: dealer.id, vin: parsed.data.vin },
    select: { id: true },
  });
  if (existing) {
    return errorResponse("DUPLICATE_VIN", "You already have a vehicle with this VIN", 409);
  }

  try {
    const item = await prisma.inventoryItem.create({
      data: {
        dealerId: dealer.id,
        lane: "LANE_1",
        year: parsed.data.year,
        make: parsed.data.make,
        model: parsed.data.model,
        trim: parsed.data.trim,
        priceCents: parsed.data.priceCents,
        vin: parsed.data.vin,
        mileage: parsed.data.mileage,
        condition: parsed.data.condition?.toLowerCase(),
        images: parsed.data.images ?? [],
        isActive: true,
      },
    });
    return successResponse({ item }, 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return errorResponse("DUPLICATE_VIN", "A vehicle with this VIN already exists", 409);
    }
    // eslint-disable-next-line no-console
    console.error("[dealer/inventory POST]", err);
    return errorResponse("DB_ERROR", "Could not save inventory item", 500);
  }
}
