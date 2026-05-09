import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props { params: Promise<{ id: string }> }

const updateSchema = z.object({ priceCents: z.number().int().optional(), mileage: z.number().int().optional(), description: z.string().optional(), isActive: z.boolean().optional() });

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
  const updated = await prisma.inventoryItem.update({ where: { id }, data: parsed.data });
  return successResponse({ item: updated });
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  await prisma.inventoryItem.updateMany({ where: { id, dealerId: dealer.id }, data: { isActive: false } });
  return successResponse({ deactivated: true });
}
