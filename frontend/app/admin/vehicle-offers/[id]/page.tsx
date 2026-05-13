import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import VehicleOfferDetailClient, { type DetailOffer } from "./VehicleOfferDetailClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vehicle Offer Submissions" };

interface Props { params: Promise<{ id: string }> }

export default async function VehicleOfferDetailPage({ params }: Props) {
  const { id } = await params;
  await requireAdmin();

  const offer = await prisma.vehicleOffer.findUnique({
    where: { id },
    include: {
      submissions: { orderBy: { submittedAt: "asc" } },
      buyerReviews: { orderBy: { sentAt: "desc" }, take: 1 },
      dealerInvites: { orderBy: { sentAt: "desc" } },
    },
  });
  if (!offer) notFound();

  const detail: DetailOffer = {
    id: offer.id,
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
    buyerEmail: offer.buyerEmail,
    buyerName: offer.buyerName,
    adminNotes: offer.adminNotes,
    referenceId: offer.referenceId,
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    createdAt: offer.createdAt.toISOString(),
    requestStatus: offer.requestStatus,
    submissions: offer.submissions.map((s) => ({
      id: s.id,
      dealershipName: s.dealershipName,
      contactName: s.contactName,
      contactEmail: s.contactEmail,
      contactPhone: s.contactPhone,
      submittedAt: s.submittedAt.toISOString(),
      notes: s.notes,
      vehicles: s.vehicles as unknown,
      rejected: s.rejected,
      rejectedAt: s.rejectedAt ? s.rejectedAt.toISOString() : null,
    })),
    invitations: offer.dealerInvites.map((inv) => ({
      id: inv.id,
      dealershipName: inv.dealershipName,
      dealerEmail: inv.dealerEmail,
      status: inv.status,
      sentAt: inv.sentAt.toISOString(),
    })),
    latestReview: offer.buyerReviews[0]
      ? {
          reviewToken: offer.buyerReviews[0].reviewToken,
          buyerName: offer.buyerReviews[0].buyerName,
          buyerEmail: offer.buyerReviews[0].buyerEmail,
          sentAt: offer.buyerReviews[0].sentAt.toISOString(),
        }
      : null,
  };

  return <VehicleOfferDetailClient offer={detail} appUrl={(process.env.NEXT_PUBLIC_APP_URL ?? "https://autolenis.com").trim()} />;
}
