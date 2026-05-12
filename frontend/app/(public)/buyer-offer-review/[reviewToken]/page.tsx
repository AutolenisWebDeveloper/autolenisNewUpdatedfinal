import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import BuyerOfferReviewClient, { type ReviewItem, type ReviewData } from "@/components/public/BuyerOfferReviewClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review Vehicle Offers — AutoLenis", robots: { index: false, follow: false } };

interface Props { params: Promise<{ reviewToken: string }> }

type DealerVehicle = {
  vehicleUrl: string;
  stockNumber?: string;
  vin?: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage?: number;
  color?: string;
  interiorColor?: string;
  condition: string;
  offerPriceCents: number;
  tradeInAccepted: boolean;
  financingAvailable: boolean;
  warrantyIncluded: boolean;
  warrantyDetails?: string;
  windowStickerUrl?: string;
  carfaxUrl?: string;
  photos?: string[];
  availability: string;
};

export default async function BuyerOfferReviewPage({ params }: Props) {
  const { reviewToken } = await params;
  const review = await prisma.buyerOfferReview.findUnique({
    where: { reviewToken },
    include: {
      items: { include: { submission: true }, orderBy: { id: "asc" } },
    },
  });
  if (!review) notFound();

  const isExpired = review.expiresAt ? review.expiresAt < new Date() : false;

  const items: ReviewItem[] = review.items.flatMap((item) => {
    const vs: DealerVehicle[] = Array.isArray(item.submission.vehicles)
      ? (item.submission.vehicles as unknown as DealerVehicle[])
      : [];
    const v = vs[item.vehicleIndex];
    if (!v) return [];
    return [{
      id: item.id,
      status: item.status as "PENDING" | "ACCEPTED" | "DECLINED",
      dealershipName: item.submission.dealershipName,
      vehicle: v,
    }];
  });

  const data: ReviewData = {
    reviewToken: review.reviewToken,
    buyerName: review.buyerName,
    buyerEmail: review.buyerEmail,
    adminMessage: review.adminMessage,
    items,
  };

  return <BuyerOfferReviewClient review={data} isExpired={isExpired} />;
}
