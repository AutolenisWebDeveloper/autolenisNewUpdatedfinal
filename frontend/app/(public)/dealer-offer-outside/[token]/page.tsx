import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import OutsideDealerOfferClient from "./OutsideDealerOfferClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Submit Outside Dealer Offer — AutoLenis",
  robots: { index: false, follow: false },
};

interface Props { params: Promise<{ token: string }> }

export default async function OutsideDealerOfferPage({ params }: Props) {
  const { token } = await params;

  const invite = await prisma.outsideAuctionInvite.findUnique({
    where: { token },
    include: {
      auction: { select: { id: true, status: true, endsAt: true } },
    },
  });
  if (!invite) notFound();

  if (!invite.viewedAt) {
    await prisma.outsideAuctionInvite.update({
      where: { id: invite.id },
      data: { viewedAt: new Date() },
    }).catch(() => {});
  }

  const auctionExpired = invite.auction.endsAt ? invite.auction.endsAt < new Date() : false;
  const auctionActive  = invite.auction.status === "ACTIVE" && !auctionExpired;

  return (
    <OutsideDealerOfferClient
      token={invite.token}
      dealershipName={invite.dealershipName}
      contactName={invite.contactName}
      auctionId={invite.auction.id}
      auctionStatus={invite.auction.status}
      auctionActive={auctionActive}
      endsAt={invite.auction.endsAt ? invite.auction.endsAt.toISOString() : null}
      alreadySubmitted={!!invite.respondedAt}
      existingOtdCents={invite.offerOtdCents}
    />
  );
}
