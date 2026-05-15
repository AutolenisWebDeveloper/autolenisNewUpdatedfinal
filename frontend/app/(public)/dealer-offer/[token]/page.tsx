import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import DealerOfferFormClient, { type DealerOfferData } from "@/components/public/DealerOfferFormClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Submit Dealer Offer — AutoLenis", robots: { index: false, follow: false } };

interface Props { params: Promise<{ token: string }> }

export default async function DealerOfferPage({ params }: Props) {
  const { token } = await params;

  // The token can be either a per-dealer invitation token or a generic VehicleOffer token.
  let offerRow: Awaited<ReturnType<typeof prisma.vehicleOffer.findUnique>> = null;
  let inviteRow: Awaited<ReturnType<typeof prisma.vehicleOfferDealerInvite.findUnique>> = null;

  const dealerInvite = await prisma.vehicleOfferDealerInvite.findUnique({
    where: { token },
    include: { vehicleOffer: true },
  });

  if (dealerInvite) {
    inviteRow = dealerInvite;
    offerRow = dealerInvite.vehicleOffer;
    if (dealerInvite.status === "sent") {
      await prisma.vehicleOfferDealerInvite.update({
        where: { id: dealerInvite.id },
        data: { status: "opened", openedAt: new Date() },
      }).catch(() => {});
    }
  } else {
    offerRow = await prisma.vehicleOffer.findUnique({ where: { token } });
  }

  if (!offerRow) notFound();

  const inviteExpires = inviteRow?.expiresAt ?? null;
  const offerExpires = offerRow.expiresAt ?? null;
  const effectiveExpiry = inviteExpires ?? offerExpires;
  const isExpired = effectiveExpiry ? effectiveExpiry < new Date() : false;

  const data: DealerOfferData = {
    token: offerRow.token,
    inviteToken: inviteRow?.token ?? null,
    dealershipName: inviteRow?.dealershipName ?? null,
    dealerContactName: inviteRow?.contactName ?? null,
    dealerContactEmail: inviteRow?.dealerEmail ?? null,
    vehicleYear: offerRow.vehicleYear,
    vehicleMake: offerRow.vehicleMake,
    vehicleModel: offerRow.vehicleModel,
    vehicleTrim: offerRow.vehicleTrim,
    vehicleMileage: offerRow.vehicleMileage,
    vehicleVin: offerRow.vehicleVin,
    vehicleColor: offerRow.vehicleColor,
    vehicleInteriorColor: offerRow.vehicleInteriorColor,
    vehicleCondition: offerRow.vehicleCondition,
    askingPriceCents: offerRow.askingPriceCents,
    vehicleReferenceUrl: offerRow.vehicleReferenceUrl,
    buyerCity: offerRow.buyerCity,
    buyerState: offerRow.buyerState,
    buyerZip: offerRow.buyerZip,
    buyerBudget: offerRow.buyerBudget,
    buyerMonthlyPayment: offerRow.buyerMonthlyPayment,
    buyerDownPayment: offerRow.buyerDownPayment,
    buyerNewOrUsed: offerRow.buyerNewOrUsed,
    buyerFinancing: offerRow.buyerFinancing,
    buyerTimeline: offerRow.buyerTimeline,
    buyerOpenToAlt: offerRow.buyerOpenToAlt,
    buyerHasTradeIn: offerRow.buyerHasTradeIn,
    buyerTradeYear: offerRow.buyerTradeYear,
    buyerTradeMake: offerRow.buyerTradeMake,
    buyerTradeModel: offerRow.buyerTradeModel,
    buyerTradeMileage: offerRow.buyerTradeMileage,
    buyerTradeVin: offerRow.buyerTradeVin,
    buyerTradeCondition: offerRow.buyerTradeCondition,
    buyerTradeAccident: offerRow.buyerTradeAccident,
    buyerTradePayoff: offerRow.buyerTradePayoff,
    adminNotes: offerRow.adminNotes,
    expiresAt: effectiveExpiry ? effectiveExpiry.toISOString() : null,
  };

  return <DealerOfferFormClient offer={data} isExpired={isExpired} />;
}
