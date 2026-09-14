// POST /api/admin/deals/[dealId]/financing — §12c, Finance or Operations records the checkpoint.
//
// THIS IS THE ONLY WAY `financing.status` REACHES TERMS_LOCKED, FAILED or EXPIRED.
//
// §12c: "The buyer can never mark financing completed. Only an authorized Finance or Operations
// administrator records completion, and only against external dealership or lender evidence.
// Every recording writes: source, external reference, approved amount, down payment, APR, term,
// payment, expiration, VIN, verifier identity, and verification time — into the financing audit
// trail."
//
// §13-D21, RULED: reuse `finance.preapproval.decide` (MONEY tier) with the ≥10-character reason
// the external-approval route already requires. No new permission — separating Finance from
// Operations is a decision to make when there are people in both roles, and inventing the split
// now would be a permissions-model change nobody asked for.
//
// `COMPLETED` IS REFUSED HERE, by the service, and the refusal is explicit rather than silent.
// That is checkpoint two — "after signing, before vehicle release" (§12a) — and parity row
// `deal-early/D3` assigns it, with funding clearance, to Phase 8. An admin who tries gets a
// message naming the phase rather than a 500 or, worse, a quiet no-op.
import { NextRequest } from "next/server";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import { z } from "zod";
import { FinancingPath, FinancingStatus } from "@prisma/client";
import {
  recordFinancingCheckpoint,
  FinancingCheckpointError,
} from "@/lib/services/financing/financing-checkpoint.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  // The states this phase may write. `COMPLETED` is absent from the enum on purpose: the API
  // surface should not advertise an action it will refuse.
  status: z.enum(["NOT_STARTED", "IN_PROGRESS", "TERMS_LOCKED", "FAILED", "EXPIRED", "NOT_REQUIRED_CASH"]),
  path: z.enum(["DEALER", "EXTERNAL", "CASH"]).optional(),
  reason: z.string().trim().min(10, "Reason must be at least 10 characters"),
  failureReason: z.string().trim().max(500).optional(),
  evidence: z
    .object({
      source: z.string().trim().min(1).max(200),
      externalReference: z.string().trim().max(200).nullable().optional(),
      approvedAmountCents: z.number().int().nonnegative().nullable().optional(),
      downPaymentCents: z.number().int().nonnegative().nullable().optional(),
      aprRate: z.number().min(0).max(100).nullable().optional(),
      termMonths: z.number().int().min(1).max(120).nullable().optional(),
      monthlyPaymentCents: z.number().int().nonnegative().nullable().optional(),
      expiresAt: z.coerce.date().nullable().optional(),
      evidenceDocumentId: z.string().min(1).nullable().optional(),
      externalPreApprovalId: z.string().min(1).nullable().optional(),
      vin: z.string().trim().max(17).nullable().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  // MONEY tier. A financing checkpoint is a money decision on a buyer's deal.
  const adminCheck = await requirePermissionStrict(request, "finance.preapproval.decide");
  if (!adminCheck.ok) return adminError(adminCheck.code, adminCheck.message, adminCheck.status);
  const admin = adminCheck.admin;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON", 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  try {
    const result = await recordFinancingCheckpoint({
      dealId,
      status: parsed.data.status as FinancingStatus,
      path: parsed.data.path as FinancingPath | undefined,
      actorId: admin.adminId,
      actorEmail: admin.email,
      actorType: "ADMIN",
      reason: parsed.data.reason,
      failureReason: parsed.data.failureReason ?? null,
      evidence: parsed.data.evidence,
    });
    return adminSuccess({ dealId, ...result });
  } catch (err) {
    if (err instanceof FinancingCheckpointError) {
      return adminError(err.code, err.message, err.code === "NOT_FOUND" ? 404 : 409);
    }
    throw err;
  }
}
