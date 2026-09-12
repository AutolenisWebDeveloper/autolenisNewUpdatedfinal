import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Auction Invitation — AutoLenis",
  robots: { index: false, follow: false },
};

// Where the 50% and 90% reminders land.
//
// THE REMINDER LINK CARRIES AN ID, NOT A TOKEN, and that is on purpose rather than an oversight
// worth "fixing" later. `issueInvitations` persists only `tokenHash` and never the raw token, so
// a reminder CANNOT re-mint the original link — and minting a second token per reminder would
// mean three live credentials per invitation, each independently replayable, to save a
// dealership one sign-in. An invitation id is not a credential at all: this route proves nothing
// from the URL and everything from the session.
//
// SO THE SESSION IS THE WHOLE GATE HERE (§13-D37: the token binds the invitation, the session
// authorises the portal). No session, no brief — the visitor is sent to sign in with this page as
// the return path, which is the one case where bouncing through sign-in is better than showing
// something, because there is no token to establish that the visitor is the invited dealership.
//
// A ROOFTOP WITH NO REGISTERED DEALER CANNOT RESUME, and that is a consequence of D37 worth
// naming rather than hiding: an outside rooftop has no account to sign into, so its path to
// bidding is to claim one. This page says that instead of redirecting to a sign-in page the
// dealership cannot use.

import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedDealer } from "@/lib/auth/dealer-session";
import { recordInvitationEvent } from "@/lib/services/auction/auction-invitation.service";
import { CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import DealerInvitationBrief from "@/components/dealer/DealerInvitationBrief";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ invitationId: string }>;
}

export default async function ResumeInvitationPage({ params }: Props) {
  const { invitationId } = await params;

  const inv = await prisma.auctionInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      auctionId: true,
      dealerId: true,
      rooftopId: true,
      dealershipName: true,
      contactName: true,
      status: true,
      declinedAt: true,
      offerSubmittedAt: true,
      auction: {
        select: {
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
      },
    },
  });
  if (!inv) notFound();

  const dealer = await getAuthenticatedDealer();

  // No session and no account to sign into: say so, rather than sending an outside rooftop to a
  // sign-in form it cannot complete.
  if (!dealer && inv.dealerId === null) {
    return (
      <main className="mx-auto max-w-xl p-6 md:p-10" data-testid="resume-needs-account">
        <div className={cn(CARD, "p-6")}>
          <h1 className="text-lg font-bold text-slate-900">
            You need an AutoLenis dealer account to bid
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Offers are submitted from the dealer portal, so we can prove the price came from your
            dealership. Claiming an account takes a licence number and is approved by our team.
          </p>
          <Link
            href="/dealer/apply"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
            data-testid="resume-claim-account"
          >
            Apply for an account <ArrowRight size={14} aria-hidden="true" />
          </Link>
          <p className="mt-4 text-xs text-slate-400">
            Approval may not complete before this auction closes. You will be invited to the next
            request that matches your inventory either way.
          </p>
        </div>
      </main>
    );
  }

  if (!dealer) {
    redirect(`/dealer/sign-in?next=${encodeURIComponent(`/dealer/invitation/resume/${invitationId}`)}`);
  }

  // THE SESSION MUST MATCH THIS INVITATION, by the SERVER's predicate and not a looser one.
  // Authenticated is not authorised: a dealer holding another rooftop's reminder link must not be
  // shown that rooftop's brief. `dealerId` alone, because that is what the offer and decline
  // routes scope on — see the note on the token page for why a rooftop match would offer a
  // control the server then refuses.
  const authorized = inv.dealerId !== null && dealer.id === inv.dealerId;
  if (!authorized) notFound();

  const now = new Date();
  const rejection =
    inv.status === "REPLACED"
      ? ("INVITATION_SUPERSEDED" as const)
      : inv.declinedAt
        ? ("ALREADY_DECLINED" as const)
        : inv.auction?.status !== "ACTIVE" ||
            (inv.auction.endsAt !== null && inv.auction.endsAt.getTime() <= now.getTime())
          ? ("AUCTION_NOT_ACTIVE" as const)
          : null;

  if (rejection === null) {
    await recordInvitationEvent(inv.id, "OPENED").catch(() => {});
  }

  const req = inv.auction?.vehicleRequest ?? null;

  return (
    <DealerInvitationBrief
      invitationId={inv.id}
      auctionId={inv.auctionId}
      dealershipName={inv.dealershipName}
      contactName={inv.contactName}
      rejection={rejection}
      alreadyBid={inv.offerSubmittedAt !== null}
      endsAt={inv.auction?.endsAt ? inv.auction.endsAt.toISOString() : null}
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
      signedIn
      authorized
      signInHref={`/dealer/quick-offer/${inv.auctionId}`}
    />
  );
}
