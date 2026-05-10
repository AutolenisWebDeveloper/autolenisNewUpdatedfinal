// POST /api/public/request-vehicle — public buyer vehicle-request submission
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendVehicleRequestAdminNotification,
  sendVehicleRequestConfirmation,
} from "@/lib/services/email/vehicle-offers.email";

const schema = z.object({
  fullName:        z.string().min(1).max(100),
  email:           z.string().email(),
  phone:           z.string().min(7).max(20),
  zip:             z.string().regex(/^\d{5}$/, "ZIP must be 5 digits"),
  vehicleType:     z.enum(["SUV", "Sedan", "Truck", "Van", "Coupe", "Other"]),
  preferredMake:   z.string().max(50).optional(),
  preferredModel:  z.string().max(50).optional(),
  minYear:         z.number().int().min(2010).max(2026).optional(),
  maxYear:         z.number().int().min(2010).max(2026).optional(),
  budget:          z.string().min(1).max(100),
  newOrUsed:       z.enum(["New", "Used", "Either"]),
  financingNeeded: z.enum(["Yes", "No", "Not Sure"]),
  notes:           z.string().max(1000).optional(),
  agreedToContact: z.literal(true),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
      { status: 400 },
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const summary = `Vehicle request from ${data.fullName}: ${data.vehicleType}${data.preferredMake ? ` ${data.preferredMake}` : ""}${data.preferredModel ? ` ${data.preferredModel}` : ""} | Budget: ${data.budget} | ZIP: ${data.zip}`;

  // Persist as a SYSTEM_ALERT notification so admin gets it in the inbox
  // and we keep an audit trail without a dedicated public-request table.
  try {
    await prisma.notification.create({
      data: {
        type: "SYSTEM_ALERT",
        channel: "IN_APP",
        title: `Vehicle request — ${data.fullName}`,
        body: summary,
        actionUrl: "/admin/vehicle-offers/new",
        metadata: data as unknown as Parameters<typeof prisma.notification.create>[0]["data"]["metadata"],
      },
    });
  } catch (err) {
    console.error("[request-vehicle] notification persist failed:", err);
  }

  // Best-effort email sends (do not block on failures).
  await Promise.allSettled([
    sendVehicleRequestAdminNotification({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      zip: data.zip,
      vehicleType: data.vehicleType,
      preferredMake: data.preferredMake,
      preferredModel: data.preferredModel,
      minYear: data.minYear,
      maxYear: data.maxYear,
      budget: data.budget,
      newOrUsed: data.newOrUsed,
      financingNeeded: data.financingNeeded,
      notes: data.notes,
    }),
    sendVehicleRequestConfirmation(data.email, data.fullName),
  ]);

  return NextResponse.json({ success: true });
}
