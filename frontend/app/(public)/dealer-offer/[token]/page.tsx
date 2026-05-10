import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import DealerOfferFormClient, { type DealerOfferData } from "@/components/public/DealerOfferFormClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Submit Dealer Offer — AutoLenis", robots: { index: false, follow: false } };

interface Props { params: Promise<{ token: string }> }

export default async function DealerOfferPage({ params }: Props) {
  const { token } = await params;
  const offer = await prisma.vehicleOffer.findUnique({ where: { token } });
  if (!offer) notFound();

  const isExpired = offer.expiresAt ? offer.expiresAt < new Date() : false;
  const data: DealerOfferData = {
    token: offer.token,
    vehicleYear: offer.vehicleYear,
    vehicleMake: offer.vehicleMake,
    vehicleModel: offer.vehicleModel,
    vehicleTrim: offer.vehicleTrim,
    vehicleMileage: offer.vehicleMileage,
    vehicleVin: offer.vehicleVin,
    vehicleColor: offer.vehicleColor,
    vehicleCondition: offer.vehicleCondition,
    askingPriceCents: offer.askingPriceCents,
    vehicleReferenceUrl: offer.vehicleReferenceUrl,
    buyerBudget: offer.buyerBudget,
    buyerZip: offer.buyerZip,
    buyerNewOrUsed: offer.buyerNewOrUsed,
    buyerFinancing: offer.buyerFinancing,
    adminNotes: offer.adminNotes,
  };

  return <DealerOfferFormClient offer={data} isExpired={isExpired} />;
}
