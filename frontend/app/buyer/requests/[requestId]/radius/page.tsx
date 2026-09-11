import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Widen the search",
  robots: { index: false, follow: false },
};

// §6a step 5 / S6-08b — the screen the buyer decides on.
//
// "Beyond 250 miles ONLY after the buyer records an explicit maximum distance."
//
// THIS IS A DESTINATION NAMED BY A SENT EMAIL, which is why it is a route and not a modal.
// `sourcing-driver.service.ts` puts `${APP_URL}/buyer/requests/${id}/radius` in the
// RADIUS_AUTHORIZATION_NEEDED notice and in both reminders, and a link in a sent email must
// resolve to a page — a modal reachable only from the request page would make the email's one
// call to action land somewhere the buyer then has to navigate from.
//
// WHAT THE BUYER IS ACTUALLY AGREEING TO, stated on the page rather than implied: a maximum
// distance they are willing to travel. Not a radius to search. §6a's S6-11 makes radius a
// server-side policy and never a client parameter, so the ladder reads the ceiling from the
// case and decides what to search inside it. The page says so in those words, because a buyer
// who thinks they are choosing a search radius will read the result as the platform ignoring
// them when it searches less.
//
// IT RENDERS FOR A CASE THAT IS NOT WAITING, on purpose. A buyer who follows an older email
// after the case moved on should see what happened, not a 404 — so the already-authorised and
// no-longer-applicable states are rendered states of this page, each saying where the request
// now stands.

import { requireBuyer } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  getSourcingCase,
  SOURCING_CASE_STATUS,
  effectiveRadiusMiles,
} from "@/lib/services/sourcing/sourcing-case.service";
import { describeSourcingForBuyer } from "@/lib/services/sourcing/sourcing-buyer-view";
import RadiusAuthorizationClient from "@/components/buyer/RadiusAuthorizationClient";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ requestId: string }>;
}

export default async function RadiusAuthorizationPage({ params }: Props) {
  const { requestId } = await params;
  const buyer = await requireBuyer();

  // OWNERSHIP FIRST, AND SERVER-SIDE. The id in the path is not evidence of anything until it
  // is checked against the session — the same rule the POST route applies.
  const req = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    select: { id: true, makePreference: true, modelPreference: true },
  });
  if (!req) notFound();

  const sourcingCase = await getSourcingCase(requestId);
  if (!sourcingCase) notFound();

  const view = describeSourcingForBuyer(sourcingCase);
  const awaiting = sourcingCase.status === SOURCING_CASE_STATUS.RADIUS_AUTHORIZATION_REQUIRED;
  const alreadyAuthorized = sourcingCase.authorizedRadiusMiles !== null;
  const currentReach = effectiveRadiusMiles(sourcingCase.band, sourcingCase.authorizedRadiusMiles);

  const vehicle = [req.makePreference, req.modelPreference].filter(Boolean).join(" ");

  return (
    <div className="max-w-2xl p-6 md:p-8" data-testid="radius-authorization-page">
      <Link
        href={`/buyer/requests/${requestId}`}
        className="mb-5 inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-800"
        data-testid="back-to-request"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to your request
      </Link>

      <h1 className="text-xl font-bold text-slate-900">Widen the search?</h1>
      <p className="mt-1 text-sm text-slate-600">
        {vehicle ? `For your ${vehicle} request.` : "For this vehicle request."}
      </p>

      <RadiusAuthorizationClient
        requestId={requestId}
        awaiting={awaiting}
        alreadyAuthorizedMiles={alreadyAuthorized ? sourcingCase.authorizedRadiusMiles : null}
        currentReachMiles={currentReach}
        competingCount={view.competingCount}
        caseStatus={sourcingCase.status}
      />
    </div>
  );
}
