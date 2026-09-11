// POST /api/buyer/requests/[requestId]/radius-authorization — §6a step 5, S6-08b.
//
// "Beyond 250 miles ONLY after the buyer records an explicit maximum distance."
//
// THIN BY DESIGN. The ceiling arithmetic, the case transition, the request-status mirror and
// the cancellation of the outstanding 24h/72h reminders all live in
// `lib/services/sourcing/sourcing-driver.service.ts`. The route's whole job is to prove who is
// asking, prove the request is theirs, and bound the number.
//
// THE BUYER AUTHORISES A CEILING; THE LADDER DECIDES WHAT TO SEARCH. §6a: "Radius is a
// server-side policy on the Vehicle Request, never a client-controlled parameter" (S6-11). So
// this route does not accept a radius to search — it accepts a maximum the buyer is willing to
// travel, which the ladder then reads from the case. The distinction is why there is no
// `radiusMiles` parameter anywhere in the sourcing path.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { recordRadiusAuthorization } from "@/lib/services/sourcing/sourcing-driver.service";

/**
 * An upper bound on the bound. A buyer may widen the search a long way, but an unbounded number
 * would make the ladder's final band unbounded too — and a four-digit typo would quietly turn
 * a regional search into a national one, spending validation work and possibly paid enrichment
 * on rooftops nobody will ever drive to.
 *
 * 2,000 additional miles is past any plausible drive and still finite.
 */
const MAX_ADDITIONAL_MILES = 2000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { requestId } = await params;

  let body: { additionalMiles?: unknown };
  try {
    body = (await request.json()) as { additionalMiles?: unknown };
  } catch {
    return errorResponse("VALIDATION_ERROR", "A JSON body with additionalMiles is required", 400);
  }

  const raw = body.additionalMiles;
  const additionalMiles = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(additionalMiles) || additionalMiles <= 0) {
    return errorResponse("VALIDATION_ERROR", "additionalMiles must be a positive number", 400);
  }
  if (additionalMiles > MAX_ADDITIONAL_MILES) {
    return errorResponse(
      "VALIDATION_ERROR",
      `additionalMiles must be ${MAX_ADDITIONAL_MILES} or fewer`,
      400,
    );
  }

  // OWNERSHIP, SERVER-SIDE. A buyer may only authorise their own request's radius — the
  // request id in the path is not evidence of anything until it is checked against the session.
  const owned = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    select: { id: true, status: true },
  });
  if (!owned) return errorResponse("NOT_FOUND", "Vehicle request not found", 404);

  const result = await recordRadiusAuthorization(requestId, additionalMiles);
  if (!result.ok) {
    return errorResponse(
      result.reason === "NO_CASE" ? "NOT_FOUND" : "CONFLICT",
      result.reason === "NO_CASE"
        ? "This request has no open sourcing case."
        : result.reason === "CASE_CLOSED"
          ? "This request's sourcing case is closed."
          : "The sourcing case moved while this was being recorded. Try again.",
      result.reason === "NO_CASE" ? 404 : 409,
    );
  }

  // AUDITED, because it is a buyer decision that changes what the platform spends: the ladder
  // validates and may pay to enrich rooftops inside the new ceiling, so who authorised it and
  // when is part of the §6c spend trail.
  //
  // `STATUS_CHANGE` rather than a new enum label. `audit_logs.action` is the `AdminActionType`
  // enum, so a `BUYER_RADIUS_AUTHORIZED` label would be a migration — and this IS a status
  // change: the request moves RADIUS_AUTHORIZATION_REQUIRED -> ACTIVE_SOURCING on the strength
  // of it. `userId` carries the buyer, `adminId` stays null, and the metadata carries the
  // number, so the row is findable and self-describing without widening the enum.
  await prisma.auditLog.create({
    data: {
      action: "STATUS_CHANGE",
      entityType: "VehicleRequest",
      entityId: requestId,
      userId: buyer.userId,
      metadata: {
        event: "BUYER_RADIUS_AUTHORIZED",
        additionalMiles,
        authorizedRadiusMiles: result.authorizedRadiusMiles ?? null,
      },
    },
  }).catch(() => {
    // The authorisation stands whether or not the audit row was written. Losing the record is
    // bad; refusing a buyer's answer because the audit table was briefly unavailable is worse,
    // and the case itself already carries `authorizedRadiusMiles` and its transition log.
  });

  // The buyer-visible event. §Stage 6's "Buyer sees" is an honest running account, and an
  // authorisation the buyer gave should appear in the same timeline as everything else that
  // happened to their request.
  await prisma.vehicleRequestBuyerUpdate.create({
    data: {
      requestId,
      title: "Search widened",
      body: `You authorised up to ${additionalMiles} additional miles. We are searching out to ${result.authorizedRadiusMiles} miles now.`,
    },
  }).catch(() => {});

  return successResponse({
    authorizedRadiusMiles: result.authorizedRadiusMiles,
    message: "Thanks — we're widening the search now.",
  });
}
