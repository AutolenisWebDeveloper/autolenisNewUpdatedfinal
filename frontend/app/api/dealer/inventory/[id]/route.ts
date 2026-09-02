import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { isValidVin, normalizeVin } from "@/lib/utils/vin";

interface Props { params: Promise<{ id: string }> }

// Must cover every field the edit form submits. Previously this schema listed
// only four of the nine fields the form sends and was NOT .strict(), so zod
// silently dropped vin/year/make/model/trim/condition and the route returned 200
// — a success response for a write that never happened. .strict() now makes an
// unrecognised field an explicit error rather than a silent no-op.
const updateSchema = z
  .object({
    vin: z.string().transform((v) => normalizeVin(v)).refine(isValidVin, {
      message: "VIN must be exactly 17 alphanumeric characters (no I, O, or Q)",
    }).optional(),
    year: z.number().int().min(1900).max(2100).optional(),
    make: z.string().min(1).max(64).optional(),
    model: z.string().min(1).max(64).optional(),
    trim: z.string().max(64).optional(),
    mileage: z.number().int().nonnegative().optional(),
    condition: z.enum(["NEW", "USED", "CPO"]).optional(),
    priceCents: z.number().int().positive().optional(),
    description: z.string().max(2000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const item = await prisma.inventoryItem.findFirst({ where: { id, dealerId: dealer.id } });
  if (!item) return errorResponse("NOT_FOUND", "Vehicle not found", 404);
  return successResponse({ item });
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.message, 400);
  const existing = await prisma.inventoryItem.findFirst({ where: { id, dealerId: dealer.id } });
  if (!existing) return errorResponse("NOT_FOUND", "Vehicle not found", 404);
  const { condition, ...rest } = parsed.data;
  try {
    const updated = await prisma.inventoryItem.update({
      where: { id },
      data: {
        ...rest,
        ...(condition ? { condition: condition.toLowerCase() } : {}),
        // A dealer edit IS a confirmation that this listing is still real. Without
        // stamping it, a dealer with no feed who updates a price every week would
        // still watch every listing fall out of shortlist eligibility 30 days after
        // creation (lib/services/inventory/inventory-eligibility.ts).
        lastSeenAt: new Date(),
      },
    });
    return successResponse({ item: updated });
  } catch (err) {
    // InventoryItem.vin is globally unique, so an edit can collide with a row
    // this dealer cannot see. Report the collision rather than a 500 — and stay
    // generic so it never discloses another tenant's inventory.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return errorResponse("DUPLICATE_VIN", "A vehicle with this VIN already exists", 409);
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Block archiving items currently reserved by an ACTIVE auction so the
  // auction's AuctionVehicle reference never dangles.
  const reservedIn = await prisma.auctionVehicle.findFirst({
    where: { inventoryItemId: id, auction: { status: "ACTIVE" } },
    select: { auctionId: true },
  });
  if (reservedIn) {
    return errorResponse(
      "RESERVED",
      "This vehicle is reserved by an active auction and cannot be archived until the auction closes.",
      409,
    );
  }

  // Soft delete — isActive=false keeps the row queryable for audit and
  // historical bid/deal references.
  await prisma.inventoryItem.updateMany({
    where: { id, dealerId: dealer.id },
    data: { isActive: false },
  });
  return successResponse({ deactivated: true });
}
