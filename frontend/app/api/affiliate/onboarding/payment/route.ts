import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { saveOnboardingStep } from "@/lib/services/affiliate/onboarding.service";
import { z } from "zod";

const schema = z.object({
  payoutMethod: z.enum(["ACH", "CHECK", "PAYPAL", "ZELLE"]),
  holderName:   z.string().min(1).max(200).optional(),
  routingLast4: z.string().length(4).optional(),
  accountLast4: z.string().length(4).optional(),
  accountType:  z.enum(["CHECKING", "SAVINGS"]).optional(),
  paypalEmail:  z.string().email().optional(),
  zellePhone:   z.string().max(20).optional(),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const result = schema.safeParse(body);
  if (!result.success) return errorResponse("VALIDATION_ERROR", result.error.errors[0].message, 400);

  await prisma.affiliatePaymentProfile.upsert({
    where:  { affiliateId: affiliate.id },
    create: { affiliateId: affiliate.id, ...result.data },
    update: { ...result.data },
  });

  await saveOnboardingStep(affiliate.id, 5);
  return successResponse({ step: 5 });
}
