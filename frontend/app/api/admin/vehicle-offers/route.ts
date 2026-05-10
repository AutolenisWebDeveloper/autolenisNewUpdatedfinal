// POST /api/admin/vehicle-offers — admin creates a new dealer offer link.
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com";

const schema = z.object({
  vehicleYear:         z.number().int().min(2000).max(2030),
  vehicleMake:         z.string().min(1).max(50),
  vehicleModel:        z.string().min(1).max(50),
  vehicleTrim:         z.string().max(50).optional(),
  vehicleMileage:      z.number().int().min(0).optional(),
  vehicleVin:          z.string().max(17).optional(),
  vehicleColor:        z.string().max(30).optional(),
  vehicleCondition:    z.enum(["New", "Used", "Certified Pre-Owned"]),
  askingPriceCents:    z.number().int().min(0).optional(),
  vehicleReferenceUrl: z.string().url().optional(),
  buyerName:           z.string().max(100).optional(),
  buyerEmail:          z.string().email().optional(),
  buyerBudget:         z.string().min(1).max(100),
  buyerZip:            z.string().regex(/^\d{5}$/),
  buyerNewOrUsed:      z.enum(["New", "Used", "Either"]),
  buyerFinancing:      z.enum(["Yes", "No", "Not Sure"]),
  adminNotes:          z.string().max(2000).optional(),
  expiresAt:           z.string().optional(),     // ISO date string from <input type="date">
  referenceId:         z.string().max(100).optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin session required", 401);

  let body: unknown;
  try { body = await request.json(); } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const data = parsed.data;

  let expiresAt: Date | null = null;
  if (data.expiresAt) {
    const d = new Date(data.expiresAt);
    if (isNaN(d.getTime())) {
      return adminError("VALIDATION_ERROR", "Invalid expiration date", 400);
    }
    expiresAt = d;
  }

  const offer = await prisma.vehicleOffer.create({
    data: {
      vehicleYear:         data.vehicleYear,
      vehicleMake:         data.vehicleMake,
      vehicleModel:        data.vehicleModel,
      vehicleTrim:         data.vehicleTrim ?? null,
      vehicleMileage:      data.vehicleMileage ?? null,
      vehicleVin:          data.vehicleVin ?? null,
      vehicleColor:        data.vehicleColor ?? null,
      vehicleCondition:    data.vehicleCondition,
      askingPriceCents:    data.askingPriceCents ?? null,
      vehicleReferenceUrl: data.vehicleReferenceUrl ?? null,
      buyerName:           data.buyerName ?? null,
      buyerEmail:          data.buyerEmail ?? null,
      buyerBudget:         data.buyerBudget,
      buyerZip:            data.buyerZip,
      buyerNewOrUsed:      data.buyerNewOrUsed,
      buyerFinancing:      data.buyerFinancing,
      adminNotes:          data.adminNotes ?? null,
      referenceId:         data.referenceId ?? null,
      expiresAt,
      createdByAdminId:    admin.adminId,
    },
  });

  return adminSuccess({
    id: offer.id,
    token: offer.token,
    url: `${APP_URL}/dealer-offer/${offer.token}`,
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
  }, 201);
}
