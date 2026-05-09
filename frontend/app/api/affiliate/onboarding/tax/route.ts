import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { saveOnboardingStep } from "@/lib/services/affiliate/onboarding.service";
import { z } from "zod";

const ATTESTATION_TEXT = `Under penalties of perjury, I certify that: 1) The number shown on this form is my correct taxpayer identification number, 2) I am not subject to backup withholding, 3) I am a U.S. citizen or other U.S. person, and 4) The FATCA code (if any) indicating that I am exempt from FATCA reporting is correct.`;

const schema = z.object({
  taxClassification: z.string().min(1),
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

  await prisma.affiliateTaxProfile.upsert({
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

  await saveOnboardingStep(affiliate.id, 4);
  return successResponse({ step: 4 });
}
