// POST /api/public/buyer-offer-review/[reviewToken]/question
// Buyer asks a question about a specific dealer offer item; sends an email to admin.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { sendBuyerQuestionEmail } from "@/lib/services/email/vehicle-offers.email";

const schema = z.object({
  itemId:   z.string().min(1),
  question: z.string().min(1).max(500),
});

interface Params { params: Promise<{ reviewToken: string }> }

type DealerVehicle = {
  year: number;
  make: string;
  model: string;
  trim?: string;
};

export async function POST(request: NextRequest, { params }: Params) {
  const { reviewToken } = await params;

  const review = await prisma.buyerOfferReview.findUnique({
    where: { reviewToken },
    include: { items: { include: { submission: true } } },
  });
  if (!review) {
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Review not found" } }, { status: 404 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } }, { status: 400 });
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
    return NextResponse.json({ success: false, error: { code: "NOT_FOUND", message: "Item not found in this review" } }, { status: 404 });
  }

  const vs: DealerVehicle[] = Array.isArray(item.submission.vehicles)
    ? (item.submission.vehicles as unknown as DealerVehicle[])
    : [];
  const v = vs[item.vehicleIndex];
  const vehicleLabel = v ? `${v.year} ${v.make} ${v.model}${v.trim ? ` ${v.trim}` : ""}` : "Vehicle";

  await sendBuyerQuestionEmail({
    buyerName: review.buyerName,
    buyerEmail: review.buyerEmail,
    dealershipName: item.submission.dealershipName,
    vehicleLabel,
    question: parsed.data.question,
  }).catch((err) => logger.error("[buyer-question] email failed:", err));

  return NextResponse.json({ success: true });
}
