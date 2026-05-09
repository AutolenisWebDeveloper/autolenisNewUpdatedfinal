// PATCH /api/buyer/settings — update notification + communication preferences
// GET /api/buyer/settings — return current settings

import { NextRequest } from "next/server";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/auth/api";

const VEHICLE_TYPES = ["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"] as const;
const NEW_OR_USED = ["NEW", "USED"] as const;

const prefsSchema = z.object({
  emailNotifications: z.boolean().optional(),
  smsNotifications: z.boolean().optional(),
  marketingEmails: z.boolean().optional(),
  auctionAlerts: z.boolean().optional(),
  dealUpdates: z.boolean().optional(),
  vehicleTypePreference: z.enum(VEHICLE_TYPES).optional(),
  newOrUsedPreference: z.enum(NEW_OR_USED).optional(),
});

export async function GET() {
  const buyer = await requireBuyer();
  const prefs = await prisma.buyerPreferences.findUnique({ where: { buyerId: buyer.id } }).catch(() => null);
  return successResponse({
    emailNotifications: prefs?.emailNotifications ?? true,
    smsNotifications: prefs?.smsNotifications ?? false,
    marketingEmails: prefs?.marketingEmails ?? false,
    auctionAlerts: prefs?.auctionAlerts ?? true,
    dealUpdates: prefs?.dealUpdates ?? true,
  });
}

export async function PATCH(request: NextRequest) {
  const buyer = await requireBuyer();
  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON payload", 400); }

  const parsed = prefsSchema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid input", 400);

  const saved = await prisma.buyerPreferences.upsert({
    where: { buyerId: buyer.id },
    update: parsed.data,
    create: { buyerId: buyer.id, ...parsed.data },
  });

  return successResponse({
    emailNotifications: saved.emailNotifications,
    smsNotifications: saved.smsNotifications,
    marketingEmails: saved.marketingEmails,
    auctionAlerts: saved.auctionAlerts,
    dealUpdates: saved.dealUpdates,
    vehicleTypePreference: saved.vehicleTypePreference,
    newOrUsedPreference: saved.newOrUsedPreference,
  });
}
