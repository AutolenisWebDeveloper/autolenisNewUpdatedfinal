// POST /api/dealer/auctions/[auctionId]/decline — S7-24.
//
// §Stage 7 tracks "declined" as one of the eight per-invitation states, and §Stage 7's dealer
// column is "Open, decline or respond" — three verbs, of which only two had a route. A
// dealership that cannot decline has one way to say no: silence, which the reminder rail then
// chases at 50% and 90% of the window.
//
// SCOPED TO THE DEALER'S OWN INVITATION. The gate is the same one the auction detail route
// applies — an `AuctionInvitation` for (auctionId, this dealer) — so a dealer cannot decline
// another rooftop's invitation by changing the id in the path.
//
// IDEMPOTENT. A second decline is a 200 with `alreadyDeclined`, not an error: a dealership that
// clicks twice has not done anything wrong, and the reminder cancellation has already happened.

import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { declineInvitation } from "@/lib/services/auction/auction-invitation.service";

interface Props { params: Promise<{ auctionId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { auctionId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const invitation = await prisma.auctionInvitation.findFirst({
    where: { auctionId, dealerId: dealer.id },
    select: { id: true, offerSubmittedAt: true },
  });
  if (!invitation) {
    return errorResponse("NOT_FOUND", "You do not have an invitation to this auction", 404);
  }

  const result = await declineInvitation(invitation.id);
  if (!result.ok) {
    // The one refusal: an offer already stands. Withdrawing a submitted offer is a different
    // action with different consequences for the buyer's Best Price Report, and it belongs to
    // the offer lifecycle (Phase 6) rather than being improvised here.
    return errorResponse(
      "CONFLICT",
      invitation.offerSubmittedAt
        ? "You have already submitted an offer on this auction. Contact support to withdraw it."
        : "This invitation could not be declined.",
      409,
    );
  }

  return successResponse({
    declined: true,
    alreadyDeclined: result.alreadyDeclined,
    message: result.alreadyDeclined
      ? "You had already declined this auction."
      : "Thanks — we won't remind you about this one again.",
  });
}
