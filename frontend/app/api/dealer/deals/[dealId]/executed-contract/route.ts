// POST /api/dealer/deals/[dealId]/executed-contract — §Stage 13/14d.
//
// The dealership returns the fully executed copy. §13-D29 ruled UPLOAD PLUS HASH
// VERIFICATION rather than an in-app countersign ceremony: the specification says "returns
// the fully executed copy" and "AutoLenis verifies that the executed copy corresponds", and
// an in-app dealer signature would put a dealership inside a consent regime scoped today to
// the buyer, which §13-D4's compliance review has not covered.
//
// AUTHORIZATION is the SAME chokepoint the contract upload uses — `assertDealerOwnsDeal`
// inside the service — so a dealership can only execute a contract on a deal whose winning
// offer is theirs. The route checks the session; the service checks the ownership; neither
// stands alone.

import { NextRequest } from "next/server";
import { z } from "zod";
import { NextResponse } from "next/server";
import { getRequestDealer, errorResponse } from "@/lib/auth/dealer-api";
import { assertDealerOwnsDeal, DealOwnershipError } from "@/lib/services/dealer/dealer-contract.service";
import { recordDealerExecution, DealerExecutionError } from "@/lib/services/deal/dealer-execution.service";

interface Props { params: Promise<{ dealId: string }> }

const schema = z.object({
  // The storage key of the uploaded executed copy, in the same private bucket every
  // contract version lives in. A URL is never accepted: the service HASHES the stored
  // bytes, and it can only do that for an object AutoLenis holds.
  executedDocumentUrl: z.string().trim().min(1).max(500),
});

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid request", 400);
  }

  try {
    await assertDealerOwnsDeal(dealId, dealer.id);
    const result = await recordDealerExecution({
      dealId,
      executedDocumentUrl: parsed.data.executedDocumentUrl,
      actorId: dealer.id,
      actorRole: "DEALER",
    });
    return NextResponse.json(
      {
        executed: true,
        contractVersionId: result.contractVersionId,
        // Returned so the dealership has the same tamper-evident reference AutoLenis
        // holds, rather than being asked to trust that one was recorded.
        executedDocumentHash: result.executedDocumentHash,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof DealOwnershipError) return errorResponse("NOT_FOUND", "Deal not found", 404);
    if (err instanceof DealerExecutionError) return errorResponse(err.code, err.message, 409);
    throw err;
  }
}
