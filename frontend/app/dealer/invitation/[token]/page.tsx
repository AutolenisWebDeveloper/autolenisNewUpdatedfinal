import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auction Invitation — AutoLenis",
  robots: { index: false, follow: false },
};

// S7-10 / S7-13 / §13-D37 — where a tokenised dealer invitation lands.
//
// THE TOKEN BINDS THE INVITATION; THE SESSION AUTHORISES THE PORTAL. That is the owner's D37
// ruling of 2026-09-11, and it decides the whole shape of this page. The link proves WHICH
// invitation a visitor holds — it is auction-and-rooftop-bound, single-use in the sense that it
// is never rotated, and expires with the auction. It proves nothing about who is holding it, so
// it grants nothing: every action on this page is behind a dealer session, and an
// unauthenticated visitor is shown the brief and sent to sign in.
//
// The owner declined to authorise a token-alone surface ("that is an authorization change and
// wants a security batch"), so there is no offer form here and no decline button that works
// without a session. Building one would be the thing that was not authorised.
//
// S7-13 — NO BUYER IDENTITY, AND NOTHING THAT COULD RECONSTRUCT IT. §25.1's identity firewall
// stands from invitation until the Phase 7 reaffirmation lift. This page renders the CRITERIA
// (year range, make, model, features, mileage ceiling) and a GENERAL LOCATION, which is what the
// invitation email already carries. It does not render the buyer's name, email, phone, street
// address, exact ZIP, deposit, budget ceiling, or prequalification. The query below is the
// enforcement: it does not select them, so the page cannot leak what it never loaded.
//
// WHY THE VIEW IS RECORDED HERE AND NOT IN THE RESOLVER. `resolveInvitationByToken` deliberately
// writes nothing — a resolver that stamped `openedAt` on every call would record an open from a
// link preview, a mail scanner, or a rejected attempt. This page records OPENED once, and only
// for a link that actually resolves to a live invitation.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDealer } from "@/lib/auth/dealer-session";
import {
  resolveInvitationByToken,
  recordInvitationEvent,
} from "@/lib/services/auction/auction-invitation.service";
import DealerInvitationBrief from "@/components/dealer/DealerInvitationBrief";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function DealerInvitationPage({ params }: Props) {
  const { token } = await params;

  const invitation = await resolveInvitationByToken(token);
  // A token we never issued gets a 404, not an "expired" page. Telling an unknown holder that
  // their link "expired" asserts we once issued it, which for a guessed or mangled token is
  // false — and a 404 is also the answer that tells a token-guesser the least.
  if (!invitation) notFound();

  // Record the open BEFORE the usability branch, and only for a link that is still live. An
  // open is a fact about the message; a rejection is a fact about the invitation, and stamping
  // `openedAt` from a rejected click would put opens in the funnel for links nobody could use.
  if (invitation.rejection === null) {
    await recordInvitationEvent(invitation.invitationId, "OPENED").catch(() => {
      // The brief renders either way. Losing one funnel timestamp is not a reason to refuse a
      // dealership the auction it was invited to.
    });
  }

  // THE CRITERIA, AND ONLY THE CRITERIA. Every column here is one the invitation email already
  // carried. `city`/`state` give the general location §25.1 permits; the exact ZIP, the budget,
  // the buyer row and the deposit are all absent from this select on purpose.
  const auction = await prisma.auction.findUnique({
    where: { id: invitation.auctionId },
    select: {
      id: true,
      status: true,
      endsAt: true,
      vehicleRequest: {
        select: {
          city: true,
          state: true,
          yearMin: true,
          yearMax: true,
          makePreference: true,
          modelPreference: true,
          requiredFeatures: true,
          preferredFeatures: true,
          maxMileage: true,
          tradeElected: true,
          deliveryPreference: true,
        },
      },
    },
  });

  const req = auction?.vehicleRequest ?? null;
  const dealer = await getAuthenticatedDealer();

  // THE SESSION MUST MATCH THE INVITATION, not merely exist. A signed-in dealer holding another
  // rooftop's link is authenticated but not authorised for THIS invitation, and treating any
  // session as sufficient would make the token transferable between dealerships — the isolation
  // failure the firewall exists to prevent.
  const sessionMatchesInvitation =
    dealer !== null &&
    ((invitation.dealerId !== null && dealer.id === invitation.dealerId) ||
      (invitation.rooftopId !== null && dealer.rooftopId === invitation.rooftopId));

  return (
    <DealerInvitationBrief
      invitationId={invitation.invitationId}
      auctionId={invitation.auctionId}
      dealershipName={invitation.dealershipName}
      contactName={invitation.contactName}
      rejection={invitation.rejection}
      alreadyBid={invitation.alreadyBid}
      endsAt={invitation.endsAt ? invitation.endsAt.toISOString() : null}
      generalLocation={[req?.city, req?.state].filter(Boolean).join(", ") || null}
      criteria={
        req
          ? {
              yearMin: req.yearMin,
              yearMax: req.yearMax,
              make: req.makePreference,
              model: req.modelPreference,
              requiredFeatures: req.requiredFeatures ?? [],
              preferredFeatures: req.preferredFeatures ?? [],
              maxMileage: req.maxMileage,
              tradeIndicated: req.tradeElected === true,
              deliveryPreference: req.deliveryPreference,
            }
          : null
      }
      signedIn={dealer !== null}
      authorized={sessionMatchesInvitation}
      signInHref={`/dealer/sign-in?next=${encodeURIComponent(`/dealer/quick-offer/${invitation.auctionId}`)}`}
    />
  );
}

// A note for whoever adds the offer form: it is NOT added here. `/dealer/quick-offer/[auctionId]`
// already exists, already requires a session, and already owns offer submission — this page
// hands an authorised dealer to it. Two offer forms against one auction is the parallel system
// the golden rules forbid, and the second one would be the one without a session.
