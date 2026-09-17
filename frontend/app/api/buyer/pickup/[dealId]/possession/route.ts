// POST /api/buyer/pickup/[dealId]/possession
//
// §Stage 19 — the buyer confirms possession, from THEIR OWN authenticated session, and the Deal
// completes. HANDOVER_PENDING → COMPLETED.
//
// WHY THIS ROUTE EXISTS AT ALL. Before Phase 9 the dealer's scan advanced the Deal straight to
// COMPLETED and there was no buyer-side confirmation anywhere in the product — no route, no
// field, no screen. §Stage 19 is explicit that this is the wrong shape: "A dealer release with
// no buyer confirmation reminds the buyer — the Deal never completes automatically on the
// dealer's word alone."
//
// THE SESSION IS THE POINT, not a formality. §Stage 19: "From the buyer's authenticated
// session, the buyer records: vehicle received; VIN match; odometer; condition as delivered;
// keys and promised accessories received." A dealer-entered confirmation on the buyer's behalf
// would be the same defect wearing a different hat, so ownership is enforced against the
// session's buyer id and nothing in the body can name a different buyer.
//
// Ownership is checked INSIDE `confirmPossession` against the deal it loads, and the buyer id
// here comes from the session rather than the request body.
import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { confirmPossession } from "@/lib/services/pickup/pickup-completion.service";
import { InsuranceRequiredError, ReleaseNotClearedError } from "@/lib/services/deal/deal.service";

interface Props { params: Promise<{ dealId: string }> }

const bodySchema = z.object({
  vehicleReceived: z.boolean(),
  vinMatch: z.boolean(),
  // §Stage 19 records the odometer as delivered. Optional because a buyer who cannot read it at
  // the kerb must still be able to confirm — a required field here would either block the
  // confirmation or teach people to type a zero.
  odometerAtPossession: z.number().int().min(0).max(1_000_000).optional(),
  conditionAsDelivered: z.string().trim().max(2000).optional(),
  keysAndAccessoriesReceived: z.boolean(),
  discrepancy: z
    .object({
      material: z.boolean(),
      note: z.string().trim().min(1).max(2000),
    })
    .optional(),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); }
  catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // OWNERSHIP, before anything is written. `confirmPossession` loads the deal by id alone —
  // it is a service, not a route, and must not assume its caller authorised anyone.
  const owns = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: { id: true },
  });
  if (!owns) return errorResponse("NOT_FOUND", "Deal not found", 404);

  let outcome;
  try {
    outcome = await confirmPossession({
      dealId,
      buyerId: buyer.id,
      vehicleReceived: parsed.data.vehicleReceived,
      vinMatch: parsed.data.vinMatch,
      odometerAtPossession: parsed.data.odometerAtPossession ?? null,
      conditionAsDelivered: parsed.data.conditionAsDelivered ?? null,
      keysAndAccessoriesReceived: parsed.data.keysAndAccessoriesReceived,
      discrepancy: parsed.data.discrepancy ?? null,
    });
  } catch (err) {
    // The three release gates run again inside the completion transaction, against the row as
    // read. Mapped rather than thrown, so a buyer standing at the dealership gets a sentence
    // naming who has to act instead of a 500.
    if (err instanceof InsuranceRequiredError) {
      return errorResponse("INSURANCE_REQUIRED", "Insurance proof is required before this deal can complete.", 409);
    }
    if (err instanceof ReleaseNotClearedError) {
      return errorResponse("RELEASE_NOT_CLEARED", err.message, 409);
    }
    throw err;
  }

  if (!outcome.ok) {
    switch (outcome.reason) {
      case "not_received":
        // §Stage 19's exit is "possession affirmatively confirmed". "No, I do not have the
        // vehicle" is a truthful answer to the form and must not complete anything.
        return errorResponse(
          "VEHICLE_NOT_RECEIVED",
          "Tell us you have the vehicle before we complete the deal. If something is wrong, report it here and we will open a case.",
          400,
        );
      case "not_received_reported":
        // The buyer does not have the vehicle AND told us why. The case is open and the report is
        // on the pickup — so this says a case exists, which the `not_received` copy above only
        // ever promised. Nothing is confirmed: `buyerConfirmedAt` is deliberately unwritten.
        return errorResponse(
          "DISCREPANCY_REPORTED",
          "Thanks — we've recorded that you don't have the vehicle and opened a case with our Operations team. Your deal stays open until it is resolved.",
          409,
        );
      case "discrepancy_blocks":
        // §Stage 19: "A material discrepancy blocks completion and creates an Operations case
        // with the dealership notified." The case is already open; the buyer is told so.
        return errorResponse(
          "DISCREPANCY_REPORTED",
          "Thanks — we've recorded the problem and opened a case with our Operations team. Your deal stays open until it is resolved.",
          409,
        );
      case "not_in_handover":
        return errorResponse(
          "NOT_AWAITING_CONFIRMATION",
          "This deal is not waiting for a possession confirmation yet.",
          409,
        );
      case "preconditions_unmet":
        // §Stage 20: "If any is false, the Deal is not complete and the website shows the exact
        // missing checkpoint and the responsible party." The buyer's confirmation is already
        // recorded — this refuses the COMPLETION, not the report, and says what is still owed
        // and by whom rather than "could not complete".
        //
        // THIS IS ALSO WHY `odometerAtPossession` AND `conditionAsDelivered` STAY OPTIONAL
        // ABOVE. A buyer who cannot read the odometer at the kerb must still be able to confirm;
        // §Stage 20 then names the missing mileage as the outstanding checkpoint, owned by the
        // buyer, and the deal completes when they supply it. Making the field required would
        // block the confirmation instead of collecting the evidence and asking for the rest.
        return errorResponse(
          "COMPLETION_BLOCKED",
          `We've recorded your confirmation. The deal is not complete yet: ${outcome.outstanding[0]?.detail ?? "a checkpoint is outstanding."}`,
          409,
          {
            outstanding: outcome.outstanding.map((i) => ({
              key: i.key,
              checkpoint: i.label,
              responsibleParty: i.owner,
              detail: i.detail,
            })),
          },
        );
      default:
        return errorResponse("NOT_FOUND", "Deal not found", 404);
    }
  }

  return successResponse({
    dealId,
    status: "COMPLETED",
    completedAt: outcome.completedAt.toISOString(),
    alreadyComplete: outcome.alreadyComplete,
  });
}
