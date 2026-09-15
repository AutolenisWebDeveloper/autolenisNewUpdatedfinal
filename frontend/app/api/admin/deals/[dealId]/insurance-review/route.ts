// /api/admin/deals/[dealId]/insurance-review — §Stage 15's Operations decision.
//
// §13-D31: "An upload is not approval." Before this, a buyer's upload satisfied the release
// gate on its own; now it opens a review, and this is where the review is decided.
//
// GET  — what the reviewer must confirm, and the current state.
// POST — VERIFIED / POLICY_BOUND / REJECTED / EXPIRED, with a REQUIRED defect on a refusal.
//
// The permission is the operations queue's, not a MONEY-tier one: this is a document review,
// not a money movement. §26's row assigns the insurance exception to the BUYER as owner with
// Operations deciding, and Stage 15's "who does what" says "the buyer uploads; AutoLenis
// reviews".

import { NextRequest } from "next/server";
import { z } from "zod";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
// `ops.replay` is the operations-queue permission. §26 assigns the insurance exception to
// Operations with the BUYER owning the correction, and Stage 15's "who does what" is "the
// buyer uploads proof; AutoLenis reviews" — so this is a document review by Operations, not
// a money movement, and it deliberately does NOT take the MONEY tier that funding clearance
// does. Giving a document reviewer the ability to clear funding would be the widening
// §13-D32 just declined.
import { prisma } from "@/lib/prisma";
import {
  INSURANCE_VERIFICATION_CHECKS,
  decideInsurance,
  InsuranceReviewError,
} from "@/lib/services/deal/insurance-review.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z
  .object({
    decision: z.enum(["VERIFIED", "POLICY_BOUND", "REJECTED", "EXPIRED"]),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => !["REJECTED", "EXPIRED"].includes(v.decision) || (v.reason?.trim().length ?? 0) >= 10, {
    // §26: "Name the defect; block release until corrected." Enforced at the edge as well as
    // in the service, so the API surface cannot accept a refusal the service will reject.
    message: "A rejection or expiry must name the specific defect (at least 10 characters).",
    path: ["reason"],
  });

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const gate = await requirePermissionStrict(request, "ops.replay");
  if (!gate.ok) return adminError(gate.code, gate.message, gate.status);

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: {
      insuranceStatus: true,
      vin: true,
      coBuyer: { select: { legalFirstName: true, legalLastName: true, isRequiredSigner: true } },
      buyer: { select: { firstName: true, lastName: true } },
    },
  });
  if (!deal) return adminError("NOT_FOUND", "Deal not found", 404);

  const policies = await prisma.insurancePolicy.findMany({
    where: { dealId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, providerName: true, policyNumber: true, effectiveDate: true, expiryDate: true,
      proofUrl: true, coversCoBuyer: true, vin: true, reviewedAt: true, reviewedBy: true,
      rejectionReason: true,
    },
  });

  return adminSuccess({
    insuranceStatus: deal.insuranceStatus,
    // Stated so the reviewer confirms three specific things rather than forming a general
    // impression — Stage 15 names all three and a decision trail should record which were
    // checked, not that "it looked fine".
    checks: INSURANCE_VERIFICATION_CHECKS,
    expectedNamedInsured: [deal.buyer?.firstName, deal.buyer?.lastName].filter(Boolean).join(" ") || null,
    expectedCoBuyer: deal.coBuyer
      ? [deal.coBuyer.legalFirstName, deal.coBuyer.legalLastName].filter(Boolean).join(" ") || null
      : null,
    expectedVin: deal.vin,
    policies,
  });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const gate = await requirePermissionStrict(request, "ops.replay");
  if (!gate.ok) return adminError(gate.code, gate.message, gate.status);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  try {
    await decideInsurance({
      dealId,
      decision: parsed.data.decision,
      actorId: gate.admin.adminId,
      reason: parsed.data.reason ?? null,
    });
    return adminSuccess({ decision: parsed.data.decision });
  } catch (err) {
    if (err instanceof InsuranceReviewError) return adminError(err.code, err.message, 409);
    throw err;
  }
}
