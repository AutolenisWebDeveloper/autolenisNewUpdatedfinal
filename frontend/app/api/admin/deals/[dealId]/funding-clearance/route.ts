// /api/admin/deals/[dealId]/funding-clearance — §Stage 14, checkpoint two.
//
// GET  — the six-item clearance list, each item with its state and its OWNER. Read-only, so
//        the admin screen, the buyer screen and the blocked notice all read the same
//        evaluation rather than each deriving its own.
// POST — record financing completion, or clear funding, or send the transaction back.
//
// §13-D32, RULED: `finance.funding.clear` on the MONEY tier — SUPER_ADMIN and FINANCE_ADMIN.
// Stage 14 says "an authorized Finance or Operations administrator", which describes who does
// the work rather than granting a permission; admitting OPERATIONS_ADMIN to a MONEY-tier
// permission is a widening that is hard to reverse, and narrow is reversible.
//
// THE BUYER CAN NEVER REACH THIS. HTML S[14] states it outright — "The buyer can never mark
// financing completed" — and this is an /api/admin route behind a MONEY-tier permission, so the
// only way a buyer's action reaches it is through an administrator who read the evidence.
//
// THERE IS NO OVERRIDE ON `clear`. Not an omission. An override would be conditional delivery
// with a different name, and Stage 14 forbids that outright: "A vehicle is never released on the
// expectation that financing will complete later." If an item cannot be satisfied, the answer is
// to resolve it or to send the transaction back — never to clear around it.

import { NextRequest } from "next/server";
import { z } from "zod";
import { adminError, adminSuccess } from "@/lib/auth/admin-api";
import { requirePermissionStrict } from "@/lib/auth/permissions";
import {
  clearFunding,
  evaluateFundingClearance,
  recordFinancingCompletion,
  sendBackForFinancingChange,
  FundingClearanceError,
} from "@/lib/services/deal/funding-clearance.service";
import { FinancingCheckpointError } from "@/lib/services/financing/financing-checkpoint.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("RECORD_FINANCING_COMPLETE"),
    // §13-D21's ≥10 characters, the same bar the external-approval route sets. A recording
    // this consequential carries a stated reason a human can read back.
    reason: z.string().trim().min(10, "Reason must be at least 10 characters"),
    evidence: z
      .object({
        source: z.string().trim().min(1),
        externalReference: z.string().trim().max(200).optional(),
        approvedAmountCents: z.number().int().nonnegative().optional(),
        downPaymentCents: z.number().int().nonnegative().optional(),
        aprRate: z.number().nonnegative().optional(),
        termMonths: z.number().int().positive().optional(),
        monthlyPaymentCents: z.number().int().nonnegative().optional(),
        vin: z.string().trim().max(32).optional(),
      })
      .optional(),
  }),
  z.object({
    action: z.literal("CLEAR_FUNDING"),
    reason: z.string().trim().min(10, "Reason must be at least 10 characters"),
  }),
  z.object({
    action: z.literal("SEND_BACK"),
    reason: z.string().trim().min(10, "Reason must be at least 10 characters"),
  }),
]);

export async function GET(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const gate = await requirePermissionStrict(request, "finance.funding.clear");
  if (!gate.ok) return adminError(gate.code, gate.message, gate.status);

  const evaluation = await evaluateFundingClearance(dealId);
  return adminSuccess({
    clear: evaluation.clear,
    items: evaluation.items,
    outstanding: evaluation.outstanding.map((i) => ({ key: i.key, label: i.label, owner: i.owner, detail: i.detail })),
  });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const gate = await requirePermissionStrict(request, "finance.funding.clear");
  if (!gate.ok) return adminError(gate.code, gate.message, gate.status);
  const admin = gate.admin;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  try {
    if (parsed.data.action === "RECORD_FINANCING_COMPLETE") {
      await recordFinancingCompletion({
        dealId,
        actorId: admin.adminId,
        actorEmail: admin.email,
        reason: parsed.data.reason,
        evidence: parsed.data.evidence,
      });
      return adminSuccess({ recorded: "FINANCING_COMPLETED" });
    }

    if (parsed.data.action === "CLEAR_FUNDING") {
      const result = await clearFunding({
        dealId,
        actorId: admin.adminId,
        actorRole: "ADMIN",
        reason: parsed.data.reason,
      });
      if (!result.cleared) {
        // 409 rather than 200-with-a-flag: nothing was cleared, and a success envelope
        // around a refusal is how a screen comes to show a green tick for a blocked deal.
        return adminError(
          "CLEARANCE_BLOCKED",
          "Funding cannot clear while any item is outstanding. " +
            result.outstanding.map((i) => `${i.label} (${i.owner.toLowerCase()})`).join("; "),
          409,
        );
      }
      return adminSuccess({ cleared: true });
    }

    const sentBack = await sendBackForFinancingChange({
      dealId,
      actorId: admin.adminId,
      reason: parsed.data.reason,
    });
    return adminSuccess(sentBack);
  } catch (err) {
    if (err instanceof FundingClearanceError || err instanceof FinancingCheckpointError) {
      return adminError(err.code, err.message, 409);
    }
    throw err;
  }
}
