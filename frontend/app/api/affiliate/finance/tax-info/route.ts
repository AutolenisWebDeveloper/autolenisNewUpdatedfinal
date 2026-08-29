import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { AFFILIATE_TAX_CLASSIFICATIONS } from "@/lib/constants";

const ATTESTATION = "Under penalties of perjury, I certify that the taxpayer " +
  "identification number I have provided is correct and I am not subject to " +
  "backup withholding.";

const schema = z.object({
  legalName:         z.string().trim().min(1).max(200),
  taxClassification: z.enum(AFFILIATE_TAX_CLASSIFICATIONS),
  tinType:           z.enum(["SSN", "EIN"]),
  taxId:             z.string().min(9).max(12).regex(/^[\d\-]+$/, "Tax ID must contain only digits and dashes"),
  certified:         z.literal(true, { errorMap: () => ({ message: "You must certify under penalty of perjury" }) }),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { taxId, taxClassification, tinType, legalName } = parsed.data;

  const digits   = taxId.replace(/\D/g, "");
  const tinLast4 = digits.slice(-4);
  const now      = new Date();

  const record = await prisma.affiliateTaxProfile.upsert({
    where: { affiliateId: affiliate.id },
    create: {
      affiliateId:       affiliate.id,
      legalName,
      taxClassification,
      tinType,
      tinLast4,
      certified:         true,
      certifiedAt:       now,
      attestationText:   ATTESTATION,
    },
    update: {
      legalName,
      taxClassification,
      tinType,
      tinLast4,
      certified:         true,
      certifiedAt:       now,
      attestationText:   ATTESTATION,
    },
  });

  return successResponse({ taxProfile: { id: record.id, tinLast4, certified: true } });
}
