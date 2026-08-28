// GET /api/buyer/profile — buyer personal info for client hydration
// PATCH /api/buyer/profile — update editable buyer profile fields

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/auth/api";

export const dynamic = "force-dynamic";

const updateSchema = z.object({
  firstName: z.string().min(1).max(64).optional(),
  lastName: z.string().min(1).max(64).optional(),
  phone: z.string().max(24).optional().or(z.literal("")),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().length(2).optional().or(z.literal("")),
  zip: z.string().max(10).optional().or(z.literal("")),
});

export async function GET() {
  const buyer = await requireBuyer();
  return NextResponse.json({
    success: true,
    data: {
      id: buyer.id,
      firstName: buyer.firstName,
      lastName: buyer.lastName,
      email: buyer.user.email,
      phone: buyer.phone ?? "",
      address: buyer.address ?? "",
      city: buyer.city ?? "",
      state: buyer.state ?? "",
      zip: buyer.zip ?? "",
      plan: buyer.plan,
      onboardingComplete: buyer.onboardingComplete,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const buyer = await requireBuyer();
  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON payload", 400); }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return errorResponse("VALIDATION_ERROR", first?.message ?? "Invalid input", 400);
  }

  const d = parsed.data;
  const updated = await prisma.buyer.update({
    where: { id: buyer.id },
    // PATCH is a PARTIAL update. These five fields used to be written
    // unconditionally, so any caller that sent only a subset — the onboarding
    // wizard sends name fields alone — silently nulled the buyer's phone,
    // address, city, state and ZIP. Only touch a field the caller actually sent;
    // an explicit empty string still clears it.
    data: {
      ...(d.firstName ? { firstName: d.firstName } : {}),
      ...(d.lastName ? { lastName: d.lastName } : {}),
      ...(d.phone !== undefined ? { phone: d.phone || null } : {}),
      ...(d.address !== undefined ? { address: d.address || null } : {}),
      ...(d.city !== undefined ? { city: d.city || null } : {}),
      ...(d.state !== undefined ? { state: d.state ? d.state.toUpperCase() : null } : {}),
      ...(d.zip !== undefined ? { zip: d.zip || null } : {}),
    },
    select: { firstName: true, lastName: true, phone: true, address: true, city: true, state: true, zip: true },
  });

  return successResponse(updated);
}
