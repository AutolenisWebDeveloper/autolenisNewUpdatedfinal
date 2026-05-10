// POST /api/public/buyer-offer-review/[reviewToken]/respond — buyer accepts or
// declines a single review item. On ACCEPTED, notify admin + dealer.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  sendBuyerAcceptedAdminNotification,
  sendDealerAcceptanceNotification,
} from "@/lib/services/email/vehicle-offers.email";

const schema = z.object({
  itemId:    z.string().min(1),
  status:    z.enum(["ACCEPTED", "DECLINED"]),
  buyerNote: z.string().max(1000).optional(),
});

interface Params { params: Promise<{ reviewToken: string }> }

type DealerVehicle = {
  vehicleUrl: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  offerPriceCents: number;
  availability: string;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { reviewToken } = await params;

  const review = await prisma.buyerOfferReview.findUnique({
    where: { reviewToken },
    include: { items: { include: { submission: true } } },
  });
  if (!review) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Review not found" } },
      { status: 404 },
    );
  }

  if (review.expiresAt && review.expiresAt < new Date()) {
    return NextResponse.json(
      { success: false, error: { code: "EXPIRED", message: "This review link has expired." } },
      { status: 410 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input" } },
      { status: 400 },
    );
  }

  const item = review.items.find((i) => i.id === parsed.data.itemId);
  if (!item) {
    return NextResponse.json(
      { success: false, error: { code: "NOT_FOUND", message: "Item not found in this review" } },
      { status: 404 },
    );
  }

  await prisma.buyerOfferReviewItem.update({
    where: { id: item.id },
    data: {
      status: parsed.data.status,
      respondedAt: new Date(),
      buyerNote: parsed.data.buyerNote ?? null,
    },
  });

  if (parsed.data.status === "ACCEPTED") {
    const vs: DealerVehicle[] = Array.isArray(item.submission.vehicles)
      ? (item.submission.vehicles as unknown as DealerVehicle[])
      : [];
    const v = vs[item.vehicleIndex];
    if (v) {
      const vehicleLabel = `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}`;
      await Promise.allSettled([
        sendBuyerAcceptedAdminNotification({
          buyerName: review.buyerName,
          buyerEmail: review.buyerEmail,
          vehicleLabel,
          vehicleUrl: v.vehicleUrl,
          offerPriceCents: v.offerPriceCents,
          availability: v.availability,
          dealershipName: item.submission.dealershipName,
          dealerContactName: item.submission.contactName,
          dealerContactEmail: item.submission.contactEmail,
          dealerContactPhone: item.submission.contactPhone,
        }),
        sendDealerAcceptanceNotification({
          to: item.submission.contactEmail,
          contactName: item.submission.contactName,
          buyerName: review.buyerName,
          vehicleLabel,
        }),
      ]);
    }
  }

  return NextResponse.json({
    success: true,
    data: { itemId: item.id, status: parsed.data.status },
  });
}
