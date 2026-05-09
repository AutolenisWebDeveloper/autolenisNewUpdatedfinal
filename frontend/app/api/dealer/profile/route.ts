// PATCH /api/dealer/profile — update editable dealer profile fields.
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z
  .object({
    dealershipName: z.string().min(1).max(128).optional(),
    phone:          z.string().max(32).optional(),
    address:        z.string().max(256).optional(),
    city:           z.string().max(128).optional(),
    state:          z.string().max(64).optional(),
    zip:            z.string().max(20).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // Filter out undefined values so we only update provided fields
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as Record<string, string>;

  if (Object.keys(data).length === 0) {
    return errorResponse("VALIDATION_ERROR", "No fields provided", 400);
  }

  const updated = await prisma.dealer.update({
    where: { id: dealer.id },
    data,
  });

  return successResponse({
    dealershipName: updated.dealershipName,
    phone:          updated.phone,
    address:        updated.address,
    city:           updated.city,
    state:          updated.state,
    zip:            updated.zip,
  });
}
