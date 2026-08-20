// POST /api/buyer/financing/apply — buyer submits a credit application for a deal
// that is in FINANCING_PENDING. PII (SSN/income/employment/DOB) is encrypted at
// rest by the service; this route never stores or logs plaintext. Fails closed if
// the PII encryption key is not configured.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { createCreditApplication, submitApplication, DuplicateApplicationError } from "@/lib/services/financing/credit-application.service";
import { isFinancingEncryptionConfigured } from "@/lib/security/field-encryption";
import { isPrequalValid } from "@/lib/services/prequal/prequal.service";

const schema = z.object({
  dealId: z.string().uuid("Invalid deal ID"),
  amountRequestedCents: z.number().int().positive().max(100_000_000),
  termMonths: z.number().int().min(6).max(96),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/, "SSN must be 9 digits"),
  annualIncomeCents: z.number().int().positive().max(1_000_000_000),
  employment: z.string().max(200).optional().nullable(),
  dob: z.string().max(40).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Fail closed: never accept/store PII without a configured encryption key.
  if (!isFinancingEncryptionConfigured()) {
    return errorResponse("NOT_CONFIGURED", "Financing is not available right now.", 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const input = parsed.data;

  // Ownership + deal-state gate: the deal must belong to this buyer and be at the
  // financing stage.
  const deal = await prisma.deal.findFirst({
    where: { id: input.dealId, buyerId: buyer.id },
    select: { id: true, status: true },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);
  if (deal.status !== "FINANCING_PENDING") {
    return errorResponse("INVALID_STATE", "Financing can only be applied while the deal is in financing.", 400);
  }

  // Reuse prequal as the affordability gate (do NOT re-underwrite): a current
  // approval is required, and the requested amount is capped at the approved budget.
  const prequal = await prisma.preQualification.findUnique({
    where: { buyerId: buyer.id },
    select: { decision: true, expiresAt: true, maxOtdAmountCents: true },
  });
  if (!isPrequalValid(prequal)) {
    return errorResponse("PREQUAL_REQUIRED", "A current pre-qualification is required before applying for financing.", 400);
  }
  if (input.amountRequestedCents > prequal!.maxOtdAmountCents) {
    return errorResponse("BUDGET_EXCEEDED", "The requested amount exceeds your approved budget.", 400);
  }

  // Idempotency: one non-withdrawn application per deal. Pre-check for the friendly
  // path; the DB partial-unique index + DuplicateApplicationError catch below close
  // the double-submit race.
  const existing = await prisma.creditApplication.findFirst({
    where: { dealId: input.dealId, status: { not: "WITHDRAWN" } },
    select: { id: true, status: true },
  });
  if (existing) {
    return errorResponse("ALREADY_APPLIED", "An application already exists for this deal.", 409);
  }

  let app: { id: string };
  try {
    app = await createCreditApplication({
      dealId: input.dealId,
      buyerId: buyer.id,
      amountRequestedCents: input.amountRequestedCents,
      termMonths: input.termMonths,
      ssn: input.ssn,
      annualIncomeCents: input.annualIncomeCents,
      employment: input.employment ?? undefined,
      dob: input.dob ?? undefined,
    });
  } catch (e) {
    if (e instanceof DuplicateApplicationError) {
      return errorResponse("ALREADY_APPLIED", "An application already exists for this deal.", 409);
    }
    throw e;
  }
  await submitApplication(app.id, { actorId: buyer.id });

  return successResponse({ applicationId: app.id, status: "SUBMITTED" });
}
