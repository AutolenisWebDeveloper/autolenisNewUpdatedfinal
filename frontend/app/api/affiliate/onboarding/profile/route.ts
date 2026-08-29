import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { saveOnboardingStep, OnboardingLockedError } from "@/lib/services/affiliate/onboarding.service";
import { z } from "zod";

const schema = z.object({
  step:            z.number().int().min(2).max(3),
  firstName:       z.string().min(1).max(100).optional(),
  lastName:        z.string().min(1).max(100).optional(),
  phone:           z.string().max(20).optional(),
  dateOfBirth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
    d => { const today = new Date(); today.setHours(0,0,0,0); return new Date(d) < today; },
    { message: "Date of birth must be in the past" }
  ).optional(),
  addressLine1:    z.string().max(200).optional(),
  addressLine2:    z.string().max(200).optional().nullable(),
  city:            z.string().max(100).optional(),
  state:           z.string().max(50).optional(),
  zip:             z.string().max(20).optional(),
  entityType:      z.enum(["INDIVIDUAL","LLC","CORPORATION","PARTNERSHIP","S_CORP"]).optional(),
  businessName:    z.string().max(200).optional().nullable(),
  dbaName:         z.string().max(200).optional().nullable(),
  businessAddress: z.string().max(400).optional().nullable(),
  einLast4:        z.string().length(4).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const result = schema.safeParse(body);
  if (!result.success) return errorResponse("VALIDATION_ERROR", result.error.errors[0].message, 400);

  const { step, einLast4, ...rest } = result.data;

  // O3 — the data write and the guarded status write commit atomically; a
  // locked review (submitted/decided) rejects the whole request with 409.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.affiliateProfile.upsert({
        where:  { affiliateId: affiliate.id },
        create: { affiliateId: affiliate.id, ...rest, ...(einLast4 !== undefined ? { einLast4 } : {}) },
        update: { ...rest, ...(einLast4 !== undefined ? { einLast4 } : {}) },
      });
      await saveOnboardingStep(affiliate.id, step, "IN_PROGRESS", tx);
    });
  } catch (err) {
    if (err instanceof OnboardingLockedError) {
      return errorResponse("ONBOARDING_LOCKED", `Your onboarding is ${err.status.toLowerCase().replace("_", " ")} and can no longer be edited.`, 409);
    }
    throw err;
  }
  return successResponse({ step });
}
