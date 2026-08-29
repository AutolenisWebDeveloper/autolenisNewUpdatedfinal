import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { saveOnboardingStep, OnboardingLockedError } from "@/lib/services/affiliate/onboarding.service";
import { z } from "zod";
import { AFFILIATE_TAX_CLASSIFICATIONS } from "@/lib/constants";

const ATTESTATION_TEXT = `Under penalties of perjury, I certify that: 1) The number shown on this form is my correct taxpayer identification number, 2) I am not subject to backup withholding, 3) I am a U.S. citizen or other U.S. person, and 4) The FATCA code (if any) indicating that I am exempt from FATCA reporting is correct.`;

const schema = z.object({
  taxClassification: z.enum(AFFILIATE_TAX_CLASSIFICATIONS),
  tinType:           z.enum(["SSN", "EIN"]),
  tinLast4:          z.string().length(4),
  legalName:         z.string().min(1).max(200),
  certified:         z.literal(true),
  signature:         z.string().min(2),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const result = schema.safeParse(body);
  if (!result.success) return errorResponse("VALIDATION_ERROR", result.error.errors[0].message, 400);

  const { signature: _signature, ...data } = result.data;

  // O3 — data + guarded status commit atomically; a locked review → 409.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.affiliateTaxProfile.upsert({
        where:  { affiliateId: affiliate.id },
        create: {
          affiliateId:       affiliate.id,
          taxClassification: data.taxClassification,
          tinType:           data.tinType,
          tinLast4:          data.tinLast4,
          legalName:         data.legalName,
          certified:         true,
          certifiedAt:       new Date(),
          attestationText:   ATTESTATION_TEXT,
        },
        update: {
          taxClassification: data.taxClassification,
          tinType:           data.tinType,
          tinLast4:          data.tinLast4,
          legalName:         data.legalName,
          certified:         true,
          certifiedAt:       new Date(),
          attestationText:   ATTESTATION_TEXT,
        },
      });
      await saveOnboardingStep(affiliate.id, 4, "IN_PROGRESS", tx);
    });
  } catch (err) {
    if (err instanceof OnboardingLockedError) {
      return errorResponse("ONBOARDING_LOCKED", `Your onboarding is ${err.status.toLowerCase().replace("_", " ")} and can no longer be edited.`, 409);
    }
    throw err;
  }
  return successResponse({ step: 4 });
}
