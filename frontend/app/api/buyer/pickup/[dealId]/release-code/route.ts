// POST /api/buyer/pickup/[dealId]/release-code — reveal the buyer's pickup code.
//
// WHY A ROUTE EXISTS AT ALL, AND WHY IT IS A POST.
//
// Before 2026-09-16 the buyer's QR was a column: `pickups.qr_code_image`, rendered server-side on
// every load of /buyer/pickup. That is the defect this phase closes — the stored PNG decodes back
// to the raw token, so a database read yielded a working credential. Hashing the token while
// keeping the image would have passed every test the change names and left the credential
// readable anyway.
//
// With the credential hashed at rest there is nothing left to re-render: the raw value exists
// only at the moment it is minted. So the capability moves rather than disappearing — the buyer
// still shows a code at the lot, they just ask for it when they are standing there. A GET would
// be wrong twice over: this WRITES (it mints, and by minting it revokes the previous code), and a
// prefetch or a double render would silently retire a code the buyer is already holding.
//
// ONE LIVE CODE, ALWAYS. Revealing revokes whatever came before, which is what makes "your code
// is unique and single-use" true rather than aspirational. The screen says so before the buyer
// asks.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { reissueReleaseCode } from "@/lib/services/pickup/pickup.service";

interface Props { params: Promise<{ dealId: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { dealId } = await params;
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Ownership first, and scoped in the WHERE rather than compared afterwards — a deal that is
  // not this buyer's is indistinguishable from one that does not exist.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: { id: true, offer: { select: { dealerId: true } }, pickup: { select: { status: true } } },
  });
  if (!deal) return errorResponse("NOT_FOUND", "Deal not found", 404);

  // A concierge (vehicle-request) deal has no Offer and VehicleRequestOffer carries no dealer
  // identity, so there is no dealer account that could ever scan this code. Minting one would
  // hand the buyer a credential with no reader — the same dead end the pickup page already
  // explains in words.
  if (!deal.offer?.dealerId) {
    return errorResponse(
      "NO_DEALER_ON_DEAL",
      "This is a concierge-coordinated pickup. Our team confirms the handover with you directly — there's no dealership code to show.",
      409,
    );
  }

  if (!deal.pickup) {
    return errorResponse("NOT_READY_FOR_PICKUP", "No pickup has been scheduled for this deal yet.", 409);
  }

  const reissued = await reissueReleaseCode(dealId);
  if (!reissued) {
    // `issueReleaseToken` refuses outside SCHEDULED / RESCHEDULED / CHECKED_IN. Naming the state
    // back to the buyer is the difference between "this is broken" and "the dealership hasn't
    // confirmed your time yet".
    return errorResponse(
      "NOT_READY_FOR_PICKUP",
      `Your pickup code is available once the dealership has confirmed your time. This pickup is ${deal.pickup.status.replace(/_/g, " ").toLowerCase()}.`,
      409,
    );
  }

  // The image and the expiry, and nothing else. The raw token is inside the PNG and is never
  // returned as text, never logged, and never written to a row.
  return successResponse({
    releaseCodeImage: reissued.image,
    expiresAt: reissued.expiresAt.toISOString(),
  });
}
