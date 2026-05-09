import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const inventory = await prisma.inventoryItem.findMany({ where: { dealerId: dealer.id }, orderBy: { createdAt: "desc" } });
  return successResponse({ inventory });
}

const createSchema = z.object({
  year: z.number().int().min(1900).max(2100),
  make: z.string().min(1).max(64),
  model: z.string().min(1).max(64),
  trim: z.string().max(64).optional(),
  priceCents: z.number().int().positive(),
  vin: z.string().min(11).max(17),
  mileage: z.number().int().nonnegative().optional(),
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
