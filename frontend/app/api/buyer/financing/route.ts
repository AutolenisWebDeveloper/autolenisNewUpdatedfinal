// POST /api/buyer/financing — save a financing SCENARIO for the buyer's active deal.
//
// PHASE 7 SEPARATED A SCENARIO FROM A CHECKPOINT, which is what this route had conflated.
//
// Before this phase it did three things in one handler:
//   1. computed a monthly payment from the buyer's own inputs — a scenario, and legitimate;
//   2. UPSERTED `Financing` with `status: SELECTED` (a §13-D18 legacy value) and
//      `approvedAmountCents` taken from the BUYER-SUPPLIED `otdAmountCents`;
//   3. advanced the deal FINANCING_PENDING → FEE_PENDING.
//
// (2) and (3) are §12c inverted. `approvedAmountCents` on `Financing` is the LENDER's approved
// amount, verified by Finance or Operations against the lender's own evidence — and
// `app/dealer/financing/page.tsx` renders it to the winning dealership under the heading
// "Approved". A buyer typing their own figure into that column, and then advancing past the
// checkpoint on the strength of it, is a buyer self-certifying a credit decision.
//
// So this route now writes a `FinancingScenario` — which is exactly what the model is for: a
// buyer's own what-if, keyed on buyer and deal, with no status and no verifier. It writes no
// `Financing` row, sets no status, and advances nothing. The buyer's PATH election goes through
// `PATCH /api/buyer/deal/financing`; the checkpoint is Finance's.
//
// The prequal ceiling check is KEPT and strengthened in place: it was already server-side and
// read-only from the approval, and it stays the backstop on a scenario the buyer cannot afford.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  otdAmountCents: z.number().int().positive(),
  downPaymentCents: z.number().int().nonnegative().default(0),
  termMonths: z.number().int().min(12).max(96),
  aprDecimal: z.number().min(0).max(0.4),
  financingPath: z.enum(["DEALER", "EXTERNAL", "CASH"]),
  /** Which deal this scenario is for. Optional for a buyer with exactly one live deal. */
  dealId: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { otdAmountCents, downPaymentCents, termMonths, aprDecimal, financingPath } = parsed.data;

  // Read the OTD ceiling from the approval — never from the client.
  const prequal = buyer.preQualification;
  if (!prequal || prequal.expiresAt <= new Date()) {
    return errorResponse("PREQUAL_REQUIRED", "Valid prequalification required before financing", 400);
  }
  if (otdAmountCents > prequal.maxOtdAmountCents) {
    return errorResponse(
      "BUDGET_EXCEEDED",
      `Out-the-door amount exceeds your approved budget of $${(prequal.maxOtdAmountCents / 100).toLocaleString()}.`,
      422,
    );
  }

  // THE EXPLICIT BRANCH WAS SCOPED BY BUYER ALONE while the fallback beside it filtered status, so
  // a buyer passing the id of their own CANCELLED, REFUNDED or COMPLETED deal got a financing
  // scenario modelled against it. A scenario is a calculator artefact, not a checkpoint — but it
  // is stored, keyed to the deal, and read back on a surface that presents it as this deal's
  // financing.
  //
  // The terminal states are EXCLUDED rather than the live ones enumerated: narrowing this branch
  // to the fallback's two would remove the ability to model financing at FEE_PENDING or
  // CONTRACT_PENDING, which it has today. The fallback keeps its own tighter filter because its
  // job is to pick the ONE deal the buyer is working on, not to validate a named one.
  const deal = parsed.data.dealId
    ? await prisma.deal.findFirst({
        where: {
          id: parsed.data.dealId,
          buyerId: buyer.id,
          status: { notIn: ["CANCELLED", "REFUNDED", "COMPLETED"] },
        },
        select: { id: true },
      })
    : await prisma.deal.findFirst({
        where: { buyerId: buyer.id, status: { in: ["RECAP_PENDING", "FINANCING_PENDING"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
  if (!deal) return errorResponse("NOT_FOUND", "No active deal", 404);

  // Standard amortisation on the amount the buyer would finance.
  const loanAmountCents = Math.max(0, otdAmountCents - downPaymentCents);
  const monthlyRate = aprDecimal / 12;
  const monthlyPaymentCents =
    monthlyRate === 0
      ? Math.round(loanAmountCents / termMonths)
      : Math.round(
          (loanAmountCents * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
            (Math.pow(1 + monthlyRate, termMonths) - 1),
        );

  // A SCENARIO, not a checkpoint. No status, no verifier, no advance — see the header.
  const scenario = await prisma.financingScenario.create({
    data: {
      buyerId: buyer.id,
      dealId: deal.id,
      name: `${financingPath} · ${termMonths} months`,
      vehiclePriceCents: otdAmountCents,
      downPaymentCents,
      loanAmountCents,
      aprRate: aprDecimal,
      termMonths,
      monthlyPaymentCents,
      totalCostCents: monthlyPaymentCents * termMonths + downPaymentCents,
    },
    select: { id: true },
  });

  return successResponse({
    scenarioId: scenario.id,
    dealId: deal.id,
    financingPath,
    otdAmountCents,
    downPaymentCents,
    termMonths,
    aprDecimal,
    monthlyPaymentCents,
  });
}
